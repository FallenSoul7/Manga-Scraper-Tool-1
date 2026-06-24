// routes/ai.ts
import { Router } from "express";
import { PROMPTS } from "./ai-powers/prompts";

const router = Router();

const FETCH_TIMEOUT_MS = 65_000;

// ── API key collection ────────────────────────────────────────────
function collectKeys(base: string): string[] {
  const keys: string[] = [];
  const first = process.env[base] ?? "";
  if (first) keys.push(first);
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`${base}_${i}`] ?? "";
    if (k) keys.push(k);
  }
  return keys;
}

const UNCENSORED_MODELS = [
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  "cognitivecomputations/dolphin3.0-mistral-24b:free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
];

function buildProviders() {
  const groqKeys = collectKeys("GROQ_API_KEY");
  const geminiKeys = collectKeys("GEMINI_API_KEY");
  const openrouterKeys = collectKeys("OPENROUTER_API_KEY");

  type Provider = { name: string; url: string; key: string; model: string; isUncensored: boolean };
  const providers: Provider[] = [];

  for (let i = 0; i < groqKeys.length; i++) {
    providers.push({
      name: i > 0 ? `Groq (key ${i + 1})` : "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKeys[i],
      model: "llama-3.3-70b-versatile",
      isUncensored: false,
    });
  }
  for (let i = 0; i < geminiKeys.length; i++) {
    providers.push({
      name: i > 0 ? `Gemini (key ${i + 1})` : "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: geminiKeys[i],
      model: "gemini-2.5-flash",
      isUncensored: false,
    });
  }
  for (let i = 0; i < openrouterKeys.length; i++) {
    providers.push({
      name: i > 0 ? `OpenRouter (key ${i + 1})` : "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouterKeys[i],
      model: "openrouter/free",
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

// ── Parser: JSON / XML / plain text with arg_key/arg_value ──
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

  // 2. Try XML: <tool_call>name<arg_key>key</arg_key><arg_value>value</arg_value></tool_call>
  const xmlRegex = /<tool_call>\s*(\w+)\s*(.*?)<\/tool_call>/s;
  const match = content.match(xmlRegex);
  if (match) {
    const name = match[1];
    const body = match[2];
    const args: Record<string, any> = {};
    const argRegex = /<arg_key>(.*?)<\/arg_key>\s*<arg_value>(.*?)<\/arg_value>/g;
    let argMatch;
    while ((argMatch = argRegex.exec(body)) !== null) {
      const key = argMatch[1].trim();
      const val = argMatch[2].trim();
      if (key && val) args[key] = val;
    }
    return [{
      id: `call_${Date.now()}`,
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    }];
  }

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
router.post("/chat", async (req, res) => {
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

  let lastError = "No API keys are configured.";

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
        const errText = await aiRes.text();
        if (aiRes.status === 404) {
          throw new Error(`Model ${provider.model} not found – skipping.`);
        }
        throw new Error(`${aiRes.status} — ${errText.slice(0, 300)}`);
      }

      const data = await aiRes.json() as any;
      const choice = data.choices?.[0];
      let content: string | null = choice?.message?.content ?? null;

      if (isBlocked(content)) {
        throw new Error(`Content blocked by ${provider.name} alignment filter.`);
      }

      // ── Use the new parser ──
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
      lastError = err.message ?? String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  res.status(502).json({ error: `All AI providers exhausted. Last error: ${lastError}` });
});

export default router;
