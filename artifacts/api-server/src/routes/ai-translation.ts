import { createHash } from "node:crypto";
import { logger } from "../lib/logger";
import { getSupabaseAdmin } from "../lib/supabase";

export type TranslationProviderMode = "auto" | "gemini" | "openrouter";

export interface TranslationRegion {
  id: string;
  sourceText: string;
  translatedText: string;
  /** Coordinates are normalized to the 0..1000 image coordinate space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TranslationProvider {
  name: string;
  url: string;
  key: string;
  model: string;
  kind: "gemini" | "openrouter" | "custom";
}

interface TranslationRequest {
  imageDataUrl: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerMode: TranslationProviderMode;
  /** Region mode asks the model to validate the crop before translating it. */
  bubbleCheck?: boolean;
  sourceId?: string;
  chapterId?: string;
  pageIndex?: number;
  signal?: AbortSignal;
}

interface TranslationResult {
  regions: TranslationRegion[];
  provider: string;
  cacheKey?: string;
  imageSha256?: string;
  cacheHit: boolean;
}

const GEMINI_CHAT_COMPLETIONS_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const PAGE_TRANSLATION_TIMEOUT_MS = 45_000;
const MAX_CUSTOM_PROVIDERS = 100;
const MAX_CUSTOM_PROVIDER_ATTEMPTS = 3;
const MAX_PAGE_IMAGE_DATA_URL_CHARS = 3_300_000;
const TRANSLATION_REVISION = "page-overlay-v1";
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const CACHE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
interface InFlightTranslation {
  controller: AbortController;
  consumers: number;
  settled: boolean;
  promise: Promise<{ regions: TranslationRegion[]; provider: string }>;
}
const inFlightTranslations = new Map<string, InFlightTranslation>();
let lastCachePruneAt = 0;

function awaitInFlightTranslation(flight: InFlightTranslation, signal?: AbortSignal): Promise<{ regions: TranslationRegion[]; provider: string }> {
  flight.consumers += 1;
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      flight.consumers = Math.max(0, flight.consumers - 1);
      if (flight.consumers === 0 && !flight.settled) flight.controller.abort();
    };
    const onAbort = () => {
      release();
      reject(new Error("Translation request was cancelled."));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    flight.promise.then(
      result => { release(); resolve(result); },
      error => { release(); reject(error); },
    );
  });
}

function firstConfiguredOpenRouterKey(): string | undefined {
  const candidates = [process.env.OPENROUTER_TRANSLATION_API_KEY, process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_1];
  for (let index = 2; index <= 10; index += 1) {
    candidates.push(process.env[`OPENROUTER_API_KEY_${index}`]);
  }
  return candidates.find((key): key is string => !!key?.trim())?.trim();
}

function configuredCustomProviders(): TranslationProvider[] {
  const raw = process.env.COMIHUB_TRANSLATION_COMPAT_PROVIDERS;
  if (!raw) return [];

  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    logger.warn("COMIHUB_TRANSLATION_COMPAT_PROVIDERS is not valid JSON");
    return [];
  }
  if (!Array.isArray(entries)) return [];

  const providers: TranslationProvider[] = [];
  for (const entry of entries.slice(0, MAX_CUSTOM_PROVIDERS)) {
    if (!entry || typeof entry !== "object") continue;
    const config = entry as Record<string, unknown>;
    if (config.free !== true || config.vision !== true) continue;

    const apiKeyEnv = String(config.apiKeyEnv ?? "");
    const key = /^[A-Z][A-Z0-9_]{1,100}$/.test(apiKeyEnv)
      ? process.env[apiKeyEnv]?.trim()
      : undefined;
    const name = String(config.name ?? "").trim().slice(0, 60);
    const model = String(config.model ?? "").trim().slice(0, 120);
    const baseUrl = String(config.baseUrl ?? "").trim();
    if (!key || !name || !model || !baseUrl || baseUrl.length > 512) continue;

    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) continue;
      const path = parsed.pathname.replace(/\/+$/, "");
      parsed.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
      providers.push({ name, url: parsed.toString(), key, model, kind: "custom" });
    } catch {
      continue;
    }
  }
  return providers;
}

function buildTranslationProviders(mode: TranslationProviderMode): TranslationProvider[] {
  const geminiKey = (process.env.GEMINI_TRANSLATION_API_KEY ?? process.env.GEMINI_API_KEY_2)?.trim();
  const openRouterKey = firstConfiguredOpenRouterKey();
  const providers: TranslationProvider[] = [];

  if (geminiKey && mode !== "openrouter") {
    providers.push({
      name: "Gemini Flash-Lite",
      url: GEMINI_CHAT_COMPLETIONS_URL,
      key: geminiKey,
      model: "gemini-3.5-flash-lite",
      kind: "gemini",
    });
  }
  if (openRouterKey && mode !== "gemini") {
    providers.push({
      name: "OpenRouter Free",
      url: OPENROUTER_CHAT_COMPLETIONS_URL,
      key: openRouterKey,
      model: "openrouter/free",
      kind: "openrouter",
    });
  }
  if (mode === "auto") {
    providers.push(...configuredCustomProviders().slice(0, MAX_CUSTOM_PROVIDER_ATTEMPTS));
  }
  return providers;
}

function makePrompt(sourceLanguage: string, targetLanguage: string, bubbleCheck = false): string {
  const source = sourceLanguage === "auto" ? "the language detected in the image" : sourceLanguage;
  return [
    "You are ComiHub's manga/manhwa OCR and translation skill. First inspect the image carefully, detect every readable glyph or speech-bubble text block, preserve its exact location, then translate it and return text-region coordinates for a white-out overlay.",
    `Source language: ${source}. Target language: ${targetLanguage}.`,
    "Return only one valid JSON object, with no Markdown fences or commentary, in this exact shape:",
    '{"regions":[{"sourceText":"original text","translatedText":"translation","box":{"x":0,"y":0,"width":0,"height":0}}]}',
    "Use normalized integer coordinates in the 0..1000 range relative to the complete image (origin at top-left). Each box must tightly cover all original glyphs in that text block, with a small margin, and must not cover neighboring artwork or another text block.",
    "Group all lines from one speech bubble into one region when possible. Preserve reading order. The sourceText field is OCR text that the user can copy, so transcribe visible words faithfully before translating. Preserve speaker intent, names, punctuation, and natural dialogue tone. Keep translations concise enough to fit inside the same box. Do not add explanations, chapter summaries, or text that is not visible.",
    bubbleCheck
      ? "This is a user-selected bubble candidate. Confirm that the crop contains readable dialogue, narration, or a text-bearing sound effect. If it is only artwork or unreadable noise, return an empty regions array. If it contains text, return one or more tightly fitted regions using coordinates relative to this crop."
      : "Return an empty regions array only when the page truly contains no readable text; do not omit small but legible bubbles or captions.",
  ].join("\n");
}

function assistantText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => typeof part?.text === "string" ? part.text : "").join("\n");
  }
  return "";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function clampCoordinate(value: unknown, fractionalScale = false): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = fractionalScale ? number * 1000 : number;
  return Math.max(0, Math.min(1000, Math.round(normalized)));
}

function parseRegions(content: string): TranslationRegion[] {
  const parsed = parseJsonObject(content);
  const rawRegions = parsed?.regions ?? parsed?.bubbles ?? parsed?.translations;
  if (!Array.isArray(rawRegions)) return [];

  const regions: TranslationRegion[] = [];
  for (const raw of rawRegions.slice(0, 80)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const box = (item.box && typeof item.box === "object" ? item.box : item) as Record<string, unknown>;
    const sourceText = String(item.sourceText ?? item.original ?? item.source ?? "").trim().slice(0, 1200);
    const translatedText = String(item.translatedText ?? item.translation ?? item.translated ?? "").trim().slice(0, 1800);
    const rawCoordinates = [box.x ?? box.left, box.y ?? box.top, box.width, box.height, box.x2, box.y2]
      .filter(value => value !== undefined && value !== null)
      .map(value => typeof value === "number" ? value : Number(value));
    const fractionalScale = rawCoordinates.length >= 4 && rawCoordinates.every(value => Number.isFinite(value) && value >= 0 && value <= 1);
    const x = clampCoordinate(box.x ?? box.left, fractionalScale);
    const y = clampCoordinate(box.y ?? box.top, fractionalScale);
    const width = clampCoordinate(box.width ?? (typeof box.x2 === "number" && x !== null ? box.x2 - (fractionalScale ? x / 1000 : x) : undefined), fractionalScale);
    const height = clampCoordinate(box.height ?? (typeof box.y2 === "number" && y !== null ? box.y2 - (fractionalScale ? y / 1000 : y) : undefined), fractionalScale);
    if (!sourceText || !translatedText || x === null || y === null || width === null || height === null) continue;
    if (width < 4 || height < 4 || x >= 1000 || y >= 1000) continue;

    regions.push({
      id: `region-${regions.length + 1}`,
      sourceText,
      translatedText,
      x,
      y,
      width: Math.min(width, 1000 - x),
      height: Math.min(height, 1000 - y),
    });
  }
  return regions;
}

function validateImageDataUrl(imageDataUrl: string): boolean {
  return imageDataUrl.length <= MAX_PAGE_IMAGE_DATA_URL_CHARS &&
    /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/i.test(imageDataUrl);
}

function imageDigest(imageDataUrl: string): string {
  const base64 = imageDataUrl.slice(imageDataUrl.indexOf(",") + 1);
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

function translationCacheKey(imageSha256: string, sourceLanguage: string, targetLanguage: string): string {
  const material = [
    TRANSLATION_REVISION,
    imageSha256,
    sourceLanguage.trim().toLowerCase() || "auto",
    targetLanguage.trim().toLowerCase(),
  ].join("\n");
  return createHash("sha256").update(material).digest("hex");
}

async function pruneExpiredCache(client: any): Promise<void> {
  const now = Date.now();
  if (now - lastCachePruneAt < CACHE_PRUNE_INTERVAL_MS) return;
  lastCachePruneAt = now;
  const { error } = await client.rpc("prune_expired_chapter_translations");
  if (error) logger.warn({ code: error.code }, "Expired page-translation cache cleanup failed");
}

async function getCachedTranslation(cacheKey: string): Promise<{ regions: TranslationRegion[]; provider: string } | null> {
  const client: any = getSupabaseAdmin();
  if (!client) return null;
  await pruneExpiredCache(client);
  try {
    const { data, error } = await client
      .from("chapter_translations")
      .select("regions, provider")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    const regions = parseRegions(JSON.stringify({ regions: data.regions }));
    if (!regions.length) return null;
    return { regions, provider: String(data.provider ?? "Shared translation cache").slice(0, 100) };
  } catch {
    return null;
  }
}

async function storeTranslationCache(input: {
  cacheKey: string;
  imageSha256: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceId?: string;
  chapterId?: string;
  pageIndex?: number;
  result: { regions: TranslationRegion[]; provider: string };
}): Promise<{ regions: TranslationRegion[]; provider: string } | null> {
  const client: any = getSupabaseAdmin();
  if (!client) return null;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  try {
    // If the previous item has expired, remove only that key so it can be renewed.
    await client.from("chapter_translations")
      .delete()
      .eq("cache_key", input.cacheKey)
      .lte("expires_at", now.toISOString());

    const row = {
      cache_key: input.cacheKey,
      image_sha256: input.imageSha256,
      translation_revision: TRANSLATION_REVISION,
      source_language: input.sourceLanguage.trim().slice(0, 40) || "auto",
      target_language: input.targetLanguage.trim().slice(0, 40),
      regions: input.result.regions.slice(0, 80),
      provider: input.result.provider.slice(0, 100),
      source_id: input.sourceId?.trim().slice(0, 128) || null,
      chapter_id: input.chapterId?.trim().slice(0, 256) || null,
      page_index: Number.isInteger(input.pageIndex) && input.pageIndex! >= 0 && input.pageIndex! <= 10000 ? input.pageIndex : null,
      expires_at: expiresAt,
    };
    const { error } = await client.from("chapter_translations").upsert(row, {
      onConflict: "cache_key",
      ignoreDuplicates: true,
    });
    if (error) {
      logger.warn({ code: error.code }, "Page-translation cache write failed");
      return null;
    }
    // Always return the committed winner if concurrent requests reached the DB.
    return await getCachedTranslation(input.cacheKey);
  } catch {
    return null;
  }
}

async function translateWithProviders(input: {
  imageDataUrl: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerMode: TranslationProviderMode;
  bubbleCheck: boolean;
  signal: AbortSignal;
}): Promise<{ regions: TranslationRegion[]; provider: string }> {
  const providers = buildTranslationProviders(input.providerMode);
  if (providers.length === 0) {
    throw new Error("No free page-translation provider is configured. Add the dedicated Gemini key or an OpenRouter key.");
  }

  let emptyRegionResponses = 0;
  let rejectedResponses = 0;
  let requestFailures = 0;
  for (const provider of providers) {
    if (input.signal.aborted) throw new Error("Translation request was cancelled.");
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort();
    input.signal.addEventListener("abort", abortFromRequest, { once: true });
    if (input.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), PAGE_TRANSLATION_TIMEOUT_MS);
    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.key}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: makePrompt(input.sourceLanguage, input.targetLanguage, input.bubbleCheck) },
            {
              role: "user",
              content: [
                { type: "text", text: input.bubbleCheck
                  ? `Check this selected bubble candidate for readable text, then translate every readable text block to ${input.targetLanguage}.`
                  : `OCR every readable manga/manhwa text block, preserve each exact location, then translate it to ${input.targetLanguage}.` },
                { type: "image_url", image_url: { url: input.imageDataUrl } },
              ],
            },
          ],
          temperature: 0.2,
          max_tokens: 6000,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        rejectedResponses += 1;
        await response.body?.cancel().catch(() => undefined);
        logger.warn({ provider: provider.name, status: response.status }, "Page translation provider rejected the request");
        continue;
      }

      const data = await response.json() as any;
      const regions = parseRegions(assistantText(data));
      if (input.signal.aborted) throw new Error("Translation request was cancelled.");
      if (regions.length === 0) {
        emptyRegionResponses += 1;
        logger.warn({ provider: provider.name }, "Page translation provider returned no valid text regions");
        continue;
      }
      return { regions, provider: provider.name };
    } catch (error) {
      if (input.signal.aborted) throw new Error("Translation request was cancelled.");
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "request_error";
      requestFailures += 1;
      logger.warn({ provider: provider.name, reason }, "Page translation provider request failed");
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", abortFromRequest);
    }
  }

  if (emptyRegionResponses > 0 && rejectedResponses === 0 && requestFailures === 0) {
    throw new Error("The AI could read the page, but it found no confidently readable text regions. Try a clearer page, select a tighter bubble, or choose the page's source language.");
  }
  throw new Error("All free page-translation providers are unavailable or returned invalid page text. Try again later or choose another source language.");
}

export async function translatePageImage(input: TranslationRequest): Promise<TranslationResult> {
  if (input.signal?.aborted) throw new Error("Translation request was cancelled.");
  if (!validateImageDataUrl(input.imageDataUrl)) {
    throw new Error("The page image is missing, unsupported, or too large to translate.");
  }
  const targetLanguage = input.targetLanguage.trim().slice(0, 40);
  const sourceLanguage = input.sourceLanguage.trim().slice(0, 40) || "auto";
  if (!targetLanguage) throw new Error("Choose a target language.");

  const imageSha256 = imageDigest(input.imageDataUrl);
  const cacheKey = translationCacheKey(imageSha256, sourceLanguage, targetLanguage);
  const cached = await getCachedTranslation(cacheKey);
  if (input.signal?.aborted) throw new Error("Translation request was cancelled.");
  if (cached) return { ...cached, cacheKey, imageSha256, cacheHit: true };

  let flight = inFlightTranslations.get(cacheKey);
  const joinedExistingWork = !!flight;
  if (!flight) {
    const controller = new AbortController();
    const created: InFlightTranslation = {
      controller,
      consumers: 0,
      settled: false,
      promise: Promise.resolve({ regions: [], provider: "" }),
    };
    const work = (async () => {
  const result = await translateWithProviders({
        imageDataUrl: input.imageDataUrl,
        sourceLanguage,
        targetLanguage,
        providerMode: input.providerMode,
        bubbleCheck: input.bubbleCheck === true,
        signal: controller.signal,
      });
      const winner = await storeTranslationCache({
        cacheKey,
        imageSha256,
        sourceLanguage,
        targetLanguage,
        sourceId: input.sourceId,
        chapterId: input.chapterId,
        pageIndex: input.pageIndex,
        result,
      });
      return winner ?? result;
    })();
    created.promise = work;
    inFlightTranslations.set(cacheKey, created);
    const finish = () => {
      created.settled = true;
      if (inFlightTranslations.get(cacheKey) === created) inFlightTranslations.delete(cacheKey);
    };
    void work.then(finish, finish);
    flight = created;
  }

  const result = await awaitInFlightTranslation(flight, input.signal);
  return { ...result, cacheKey, imageSha256, cacheHit: joinedExistingWork };
}
