// routes/ai.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import { PROMPTS } from "./ai-powers/prompts";
import { logger } from "../lib/logger";
import { translatePageImage, type TranslationProviderMode } from "./ai-translation";
import { SUPPORTED_SOURCE_LANGUAGES, SUPPORTED_TARGET_LANGUAGES } from "./translation-languages";

const router = Router();

const FETCH_TIMEOUT_MS = 65_000;

const AI_RATE_WINDOW_MS = 60 * 60 * 1000;
const AI_CHAT_REQUESTS_PER_WINDOW = 20;
const AI_TRANSLATION_REQUESTS_PER_WINDOW = 60;
const AI_MAX_CONCURRENT = 3;
const AI_MAX_WAITING = 8;

type RateEntry = { startedAt: number[] };
const rateEntries = new Map<string, RateEntry>();
let activeAiRequests = 0;
let waitingAiRequests = 0;
const aiWaiters: Array<() => void> = [];

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function admitNextAiRequest() {
  const next = aiWaiters.shift();
  if (!next) return;
  waitingAiRequests = Math.max(0, waitingAiRequests - 1);
  activeAiRequests++;
  next();
}

function createAiAdmission(namespace: string, requestLimit: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${namespace}:${clientKey(req)}`;
    const entry = rateEntries.get(key) ?? { startedAt: [] };
    entry.startedAt = entry.startedAt.filter((time) => now - time < AI_RATE_WINDOW_MS);

    if (entry.startedAt.length >= requestLimit) {
      res.setHeader("Retry-After", "3600");
      res.status(429).json({ error: namespace === "translation" ? "Page-translation limit reached for this hour. Please try again later." : "AI request limit reached. Please try again later." });
      return;
    }

    if (activeAiRequests >= AI_MAX_CONCURRENT) {
      if (waitingAiRequests >= AI_MAX_WAITING) {
        res.setHeader("Retry-After", "30");
        res.status(429).json({ error: "AI service is busy. Please try again shortly." });
        return;
      }
      waitingAiRequests++;
      await new Promise<void>((resolve) => aiWaiters.push(resolve));
    } else {
      activeAiRequests++;
    }

    entry.startedAt.push(now);
    rateEntries.set(key, entry);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeAiRequests = Math.max(0, activeAiRequests - 1);
      admitNextAiRequest();
      if (rateEntries.size > 1000) {
        for (const [storedKey, storedEntry] of rateEntries) {
          if (!storedEntry.startedAt.some((time) => now - time < AI_RATE_WINDOW_MS)) rateEntries.delete(storedKey);
        }
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

const aiAdmission = createAiAdmission("chat", AI_CHAT_REQUESTS_PER_WINDOW);
const translationAdmission = createAiAdmission("translation", AI_TRANSLATION_REQUESTS_PER_WINDOW);

// ── API key collection ────────────────────────────────────────────
// Bases are read as <BASE>, <BASE>_1, <BASE>_2 … <BASE>_10. The previous loop
// started at _2, so a deployment that stored only GROQ_API_KEY_1 (or
// OPENROUTER_API_KEY_1) silently lost that credential.
function collectKeys(base: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const candidates = [process.env[base] ?? ""];
  for (let i = 1; i <= 10; i++) candidates.push(process.env[`${base}_${i}`] ?? "");
  for (const candidate of candidates) {
    const key = candidate.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

const UNCENSORED_MODELS = [
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", // ✅ alive 32K ctx
  "nousresearch/hermes-3-llama-3.1-405b:free",                    // ✅ alive 131K ctx
];

function buildProviders() {
  const groqKeys = collectKeys("GROQ_API_KEY");
  // Keep the first Gemini credential on chat. Key 2 is dedicated to the
  // multimodal manga translator so each task can use its appropriate model.
  // Chat also uses any other configured Gemini credential except the dedicated
  // translation key, so a _3+ key is no longer ignored.
  const geminiTranslationKey = (process.env.GEMINI_TRANSLATION_API_KEY ?? process.env.GEMINI_API_KEY_2 ?? "").trim();
  const geminiChatKey = (process.env.GEMINI_CHAT_API_KEY ?? process.env.GEMINI_API_KEY_1 ?? "").trim();
  const geminiKeys: string[] = [];
  const seenGemini = new Set<string>();
  const pushGemini = (value: string) => {
    const key = value.trim();
    if (!key || key === geminiTranslationKey || seenGemini.has(key)) return;
    seenGemini.add(key);
    geminiKeys.push(key);
  };
  pushGemini(geminiChatKey);
  for (const key of collectKeys("GEMINI_API_KEY")) pushGemini(key);
  const openrouterKeys = collectKeys("OPENROUTER_API_KEY");
  type Provider = { name: string; url: string; key: string; model: string; isUncensored: boolean };
  const providers: Provider[] = [];

  for (let i = 0; i < groqKeys.length; i++) {
    providers.push({
      name: i > 0 ? `Groq (key ${i + 1})` : "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKeys[i],
      model: process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile",
      isUncensored: false,
    });
  }
  for (let i = 0; i < geminiKeys.length; i++) {
    providers.push({
      name: i > 0 ? `Gemini (key ${i + 1})` : "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: geminiKeys[i],
      model: process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash",
      isUncensored: false,
    });
  }
  for (let i = 0; i < openrouterKeys.length; i++) {
    providers.push({
      name: i > 0 ? `OpenRouter (key ${i + 1})` : "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouterKeys[i],
      model: "openrouter/auto",
      isUncensored: false,
    });
  }

  for (const model of UNCENSORED_MODELS) {
    const shortName = model.split("/")[1]?.split(":")[0] ?? model;
    for (let i = 0; i < openrouterKeys.length; i++) {
      providers.push({
        name: i > 0 ? `OpenRouter 18+ ${shortName} (key ${i + 1})` : `OpenRouter 18+ ${shortName}`,
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: openrouterKeys[i],
        model,
        isUncensored: true,
      });
    }
  }

  return providers;
}

const ADULT_WORDS = [
  "hentia", "hentai", "18+", "nsfw", "xxx", "erotic", "smut",
  "lewd", "ecchi", "adult manga", "adult manhwa",
];

function isAdultContext(messages: Array<{ role: string; content: string | null }>): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const text = String(messages[i].content ?? "").toLowerCase();
      return ADULT_WORDS.some(w => text.includes(w));
    }
  }
  return false;
}

function buildQueue(modelMode: string, isAdult: boolean) {
  const all = buildProviders();
  const normal = all.filter(p => !p.isUncensored);
  const uncensored = all.filter(p => p.isUncensored);

  if (modelMode === "uncensored") return [...uncensored];
  if (modelMode === "auto" && isAdult) return [...uncensored, ...normal];
  if (modelMode === "groq") {
    return [...all.filter(p => p.name.startsWith("Groq")), ...all.filter(p => !p.name.startsWith("Groq"))];
  }
  if (modelMode === "gemini") {
    return [...all.filter(p => p.name.startsWith("Gemini")), ...all.filter(p => !p.name.startsWith("Gemini"))];
  }
  if (modelMode === "openrouter") {
    return [...all.filter(p => p.name.startsWith("OpenRouter")), ...all.filter(p => !p.name.startsWith("OpenRouter"))];
  }
  return [...normal, ...uncensored];
}

const BLOCK_PHRASES = [
  "I cannot assist with",
  "I am unable to provide",
  "I can't assist with",
  "I'm not able to",
  "I cannot provide",
  "This request involves",
  "I'm unable to",
];

function isBlocked(content: string | null): boolean {
  if (!content) return false;
  return BLOCK_PHRASES.some(p => content.includes(p));
}

type ProviderFailureReason =
  | "http_error"
  | "model_missing"
  | "rate_limited"
  | "unauthorized"
  | "timeout"
  | "request_error"
  | "blocked";

interface ProviderFailure {
  status?: number;
  code?: string;
  reason: ProviderFailureReason;
}

class ProviderRequestError extends Error {
  readonly failure: ProviderFailure;

  constructor(message: string, failure: ProviderFailure) {
    super(message);
    this.failure = failure;
  }
}

/**
 * Read only the provider's short machine-readable error code. Provider prose,
 * request bodies, prompts, and API-key values are never logged or returned to
 * the client; without this, logs could not distinguish an invalid credential
 * from a quota, model, or availability failure.
 */
// Express's Response type is imported in this module, so the fetch response type
// is derived from fetch itself rather than from the global Response name.
type ProviderFetchResponse = Awaited<ReturnType<typeof fetch>>;

async function readProviderErrorCode(response: ProviderFetchResponse): Promise<string | undefined> {
  let body = "";
  try {
    body = (await response.text()).slice(0, 2000);
  } catch {
    return undefined;
  }
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as any;
    const nested = parsed?.error;
    const raw = typeof nested === "object" && nested !== null
      ? (nested.code ?? nested.type)
      : (nested ?? parsed?.code);
    const value = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
    return /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function classifyHttpFailure(status: number): ProviderFailureReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "http_error";
}

function sanitizeMessages(
  messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>
) {
  const sanitized = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const entry: any = { role: "assistant", content: msg.content ?? null };
      if (msg.tool_calls?.length) entry.tool_calls = msg.tool_calls;
      sanitized.push(entry);
    } else if (msg.role === "tool") {
      sanitized.push({
        role: "tool",
        tool_call_id: msg.tool_call_id ?? "unknown",
        name: msg.name ?? "unknown",
        content: String(msg.content ?? ""),
      });
    } else if (msg.role === "user") {
      sanitized.push({ role: "user", content: String(msg.content ?? "") });
    }
  }

  const cleaned = [];
  for (let i = 0; i < sanitized.length; i++) {
    const msg = sanitized[i];
    if (msg.role === "tool") {
      const prev = cleaned[cleaned.length - 1];
      if (!prev || prev.role !== "assistant" || !prev.tool_calls?.length) {
        continue;
      }
    }
    cleaned.push(msg);
  }
  return cleaned;
}

// ── Enhanced parser: JSON + XML (both formats) + plain arg_key/arg_value ──
function parseToolCalls(content: string): any[] | null {
  // 1. Try JSON: {"tool": "...", "args": {...}}
  const jsonRegex = /\{["']tool["']\s*:\s*["'][^"']+["']\s*,\s*["']args["']\s*:\s*\{[^}]*\}\s*\}/g;
  const jsonMatches = content.match(jsonRegex);
  if (jsonMatches) {
    const calls: any[] = [];
    for (const jsonStr of jsonMatches) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool && parsed.args) {
          calls.push({
            id: `call_${Date.now()}_${calls.length}`,
            type: "function",
            function: {
              name: parsed.tool,
              arguments: JSON.stringify(parsed.args),
            },
          });
        }
      } catch {}
    }
    if (calls.length > 0) return calls;
  }

  // 2. Try XML with <tool_call> ... </tool_call> (both the arg_key/arg_value and the function=.../parameter=... variants)
  // First, extract all <tool_call> blocks.
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)<\/tool_call>/g;
  let match;
  const calls: any[] = [];
  while ((match = toolCallRegex.exec(content)) !== null) {
    const body = match[1].trim();
    // Try to parse function name and parameters.
    let name: string | null = null;
    const args: Record<string, any> = {};

    // Variant A: <function=...> and <parameter=...>
    const funcMatch = body.match(/<function=(\w+)>/);
    if (funcMatch) {
      name = funcMatch[1];
      // Extract parameters: <parameter=key>value</parameter>
      const paramRegex = /<parameter=(\w+)>([^<]*)<\/parameter>/g;
      let pMatch;
      while ((pMatch = paramRegex.exec(body)) !== null) {
        args[pMatch[1]] = pMatch[2].trim();
      }
    } else {
      // Variant B: <function>name</function> and <arg_key>key</arg_key><arg_value>value</arg_value>
      const funcNameMatch = body.match(/<function>\s*(\w+)\s*<\/function>/);
      if (funcNameMatch) {
        name = funcNameMatch[1];
        const argRegex = /<arg_key>(.*?)<\/arg_key>\s*<arg_value>(.*?)<\/arg_value>/g;
        let aMatch;
        while ((aMatch = argRegex.exec(body)) !== null) {
          args[aMatch[1].trim()] = aMatch[2].trim();
        }
      } else {
        // Variant C: just plain arg_key/arg_value without wrapper (already handled later)
        // Skip here.
      }
    }

    if (name && Object.keys(args).length > 0) {
      calls.push({
        id: `call_${Date.now()}_${calls.length}`,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(args),
        },
      });
    }
  }

  if (calls.length > 0) return calls;

  // 3. Try plain text with arg_key/arg_value (no wrapper)
  const plainRegex = /(\w+)\s*<arg_key>(.*?)<\/arg_key>\s*<arg_value>(.*?)<\/arg_value>/g;
  let plainName: string | null = null;
  const plainArgs: Record<string, any> = {};
  let plainMatch;
  while ((plainMatch = plainRegex.exec(content)) !== null) {
    if (!plainName) plainName = plainMatch[1];
    plainArgs[plainMatch[2].trim()] = plainMatch[3].trim();
  }
  if (plainName && Object.keys(plainArgs).length > 0) {
    return [{
      id: `call_${Date.now()}`,
      type: "function",
      function: {
        name: plainName,
        arguments: JSON.stringify(plainArgs),
      },
    }];
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────
router.post("/chat", aiAdmission, async (req, res) => {
  const { messages: rawMessages, modelMode = "auto" } = req.body as {
    messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>;
    modelMode: string;
  };

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const isAdult = isAdultContext(rawMessages);
  const queue = buildQueue(modelMode, isAdult);
  const cleanMessages = sanitizeMessages(rawMessages);

  const apiMessages = [
    { role: "system", content: PROMPTS.system },
    { role: "system", content: PROMPTS.skills },
    ...cleanMessages,
  ];

  let providerFailures = 0;
  let unauthorizedFailures = 0;
  let rateLimitedFailures = 0;

  for (const provider of queue) {
    if (!provider.key) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const body: any = {
        model: provider.model,
        messages: apiMessages,
        temperature: provider.isUncensored ? 0.7 : 0.3,
        max_tokens: 4000,
      };

      const aiRes = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!aiRes.ok) {
        const code = await readProviderErrorCode(aiRes);
        if (aiRes.status === 404) {
          throw new ProviderRequestError(`Model ${provider.model} not found – skipping.`, {
            status: 404,
            code: code ?? "model_not_found",
            reason: "model_missing",
          });
        }
        throw new ProviderRequestError(`Provider returned HTTP ${aiRes.status}`, {
          status: aiRes.status,
          code,
          reason: classifyHttpFailure(aiRes.status),
        });
      }

      const data = await aiRes.json() as any;
      const choice = data.choices?.[0];
      let content: string | null = choice?.message?.content ?? null;

      if (isBlocked(content)) {
        throw new ProviderRequestError(`Content blocked by ${provider.name} alignment filter.`, { reason: "blocked" });
      }

      // ── Use the enhanced parser ──
      let tool_calls = choice?.message?.tool_calls ?? null;
      if (!tool_calls && content) {
        const parsed = parseToolCalls(content);
        if (parsed) {
          tool_calls = parsed;
          content = null; // hide raw text from user
        }
      }

      res.json({
        content,
        tool_calls,
        provider: provider.name,
      });
      return;
    } catch (err: any) {
      providerFailures++;
      const failure: ProviderFailure | undefined = err instanceof ProviderRequestError ? err.failure : undefined;
      const reason: ProviderFailureReason = failure?.reason ?? (err?.name === "AbortError" ? "timeout" : "request_error");
      if (reason === "unauthorized") unauthorizedFailures++;
      if (reason === "rate_limited") rateLimitedFailures++;
      // Status, model, and short provider error code are safe diagnostics.
      // Key values, prompts, request bodies, and provider prose are never logged.
      logger.warn(
        { provider: provider.name, model: provider.model, status: failure?.status, code: failure?.code, reason },
        "AI provider request failed",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const error = providerFailures === 0
    ? "No AI providers are configured."
    : unauthorizedFailures === providerFailures
      ? "The configured AI credentials were rejected by the provider. An administrator needs to review the API keys."
      : rateLimitedFailures === providerFailures
        ? "AI providers are rate-limited right now. Please try again later."
        : "AI providers are temporarily unavailable.";
  res.status(502).json({ error });
});

router.post("/translate-page", translationAdmission, async (req, res) => {
  const body = req.body as {
    imageDataUrl?: unknown;
    sourceLanguage?: unknown;
    targetLanguage?: unknown;
    providerMode?: unknown;
    sourceId?: unknown;
    chapterId?: unknown;
    pageIndex?: unknown;
  };
  const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
  const sourceLanguage = typeof body?.sourceLanguage === "string" ? body.sourceLanguage : "auto";
  const targetLanguage = typeof body?.targetLanguage === "string" ? body.targetLanguage : "English";
  const providerMode = typeof body?.providerMode === "string" ? body.providerMode : "auto";
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim().slice(0, 128) : undefined;
  const chapterId = typeof body?.chapterId === "string" ? body.chapterId.trim().slice(0, 256) : undefined;
  const pageIndex = typeof body?.pageIndex === "number" && Number.isInteger(body.pageIndex) && body.pageIndex >= 0 && body.pageIndex <= 10000
    ? body.pageIndex
    : undefined;
  if (!imageDataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "A page image is required." });
    return;
  }
  if (!SUPPORTED_SOURCE_LANGUAGES.has(sourceLanguage) || !SUPPORTED_TARGET_LANGUAGES.has(targetLanguage)) {
    res.status(400).json({ error: "Choose a supported source and target language." });
    return;
  }
  if (!["auto", "gemini", "openrouter"].includes(providerMode)) {
    res.status(400).json({ error: "Choose a supported free translation route." });
    return;
  }

  const requestController = new AbortController();
  const abortOnRequestClose = () => requestController.abort();
  const abortOnResponseClose = () => {
    if (!res.writableEnded) requestController.abort();
  };
  if (req.aborted || res.destroyed) requestController.abort();
  req.once("aborted", abortOnRequestClose);
  res.once("close", abortOnResponseClose);

  try {
    const result = await translatePageImage({
      imageDataUrl,
      sourceLanguage,
      targetLanguage,
      providerMode: providerMode as TranslationProviderMode,
      sourceId,
      chapterId,
      pageIndex,
      signal: requestController.signal,
    });
    if (!res.destroyed) res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Page translation failed.";
    const status = /too large|unsupported/i.test(message) ? 413 : /choose a target/i.test(message) ? 400 : 503;
    if (!res.destroyed && !res.headersSent) res.status(status).json({ error: message });
  } finally {
    req.off("aborted", abortOnRequestClose);
    res.off("close", abortOnResponseClose);
  }
});

export default router;
