import { Router } from "express";

const router = Router();

const FETCH_TIMEOUT_MS = 65_000;

// ── Collect numbered env keys (GROQ_API_KEY, GROQ_API_KEY_2, …, GROQ_API_KEY_N) ─
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

// ── Three free uncensored OpenRouter model IDs ──────────────────────────────
const UNCENSORED_MODELS = [
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  "cognitivecomputations/dolphin3.0-mistral-24b:free",
  "nousresearch/hermes-3-llama-3.1-70b:free",
];

// ── Build the full provider list at request time so new env vars apply ───────
function buildProviders() {
  const groqKeys       = collectKeys("GROQ_API_KEY");
  const geminiKeys     = collectKeys("GEMINI_API_KEY");
  const openrouterKeys = collectKeys("OPENROUTER_API_KEY");

  type Provider = { name: string; url: string; key: string; model: string; isUncensored: boolean };
  const providers: Provider[] = [];

  // Normal censored providers — tried in key rotation order
  for (let i = 0; i < groqKeys.length; i++) {
    providers.push({
      name: `Groq${i > 0 ? ` (key ${i + 1})` : ""}`,
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKeys[i],
      model: "llama-3.3-70b-versatile",
      isUncensored: false,
    });
  }
  for (let i = 0; i < geminiKeys.length; i++) {
    providers.push({
      name: `Gemini${i > 0 ? ` (key ${i + 1})` : ""}`,
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: geminiKeys[i],
      model: "gemini-2.5-flash",
      isUncensored: false,
    });
  }
  // One normal OpenRouter model (Nex) — rotate all keys
  for (let i = 0; i < openrouterKeys.length; i++) {
    providers.push({
      name: `OpenRouter Nex${i > 0 ? ` (key ${i + 1})` : ""}`,
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouterKeys[i],
      model: "nex-agi/nex-n2-pro:free",
      isUncensored: false,
    });
  }

  // Uncensored providers — each model tried with every OpenRouter key before moving to next model
  for (const model of UNCENSORED_MODELS) {
    const shortName = model.split("/")[1]?.split(":")[0] ?? model;
    for (let i = 0; i < openrouterKeys.length; i++) {
      providers.push({
        name: `OpenRouter 18+ ${shortName}${i > 0 ? ` (key ${i + 1})` : ""}`,
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: openrouterKeys[i],
        model,
        isUncensored: true,
      });
    }
  }

  return providers;
}

// ── Adult-content keyword detection ─────────────────────────────────────────
const ADULT_WORDS = ["hentia", "hentai", "18+", "nsfw", "xxx", "erotic", "smut", "lewd", "ecchi", "adult manga", "adult manhwa"];

function isAdultContext(text: string): boolean {
  return ADULT_WORDS.some(w => text.includes(w));
}

// ── Build the ordered waterfall queue for this request ───────────────────────
function buildQueue(modelMode: string, fullText: string) {
  const all = buildProviders();
  const normal     = all.filter(p => !p.isUncensored);
  const uncensored = all.filter(p =>  p.isUncensored);
  const adult = isAdultContext(fullText);

  if (modelMode === "uncensored" || (modelMode === "auto" && adult)) {
    // Uncensored first, then normal as last-resort fallback
    return [...uncensored, ...normal];
  }
  if (modelMode === "groq") {
    return [...all.filter(p => p.name.startsWith("Groq")), ...all.filter(p => !p.name.startsWith("Groq"))];
  }
  if (modelMode === "gemini") {
    return [...all.filter(p => p.name.startsWith("Gemini")), ...all.filter(p => !p.name.startsWith("Gemini"))];
  }
  if (modelMode === "openrouter") {
    return [...all.filter(p => p.name.startsWith("OpenRouter")), ...all.filter(p => !p.name.startsWith("OpenRouter"))];
  }
  // auto — normal providers first, uncensored as final fallback
  return [...normal, ...uncensored];
}

// ── Content-blocked phrases that trigger waterfall to next provider ───────────
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

// ── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  { type: "function", function: { name: "list_sources",      description: "List all available manga sources/extensions that can be browsed (even if not installed by the user).",                                                                     parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "browse_popular",    description: "Browse popular/trending manga from a specific source.",                                                                                                                     parameters: { type: "object", properties: { sourceId: { type: "string", description: "Source ID from list_sources" } }, required: ["sourceId"] } } },
  { type: "function", function: { name: "search_manga",      description: "Search for manga by title or keyword in a specific source.",                                                                                                               parameters: { type: "object", properties: { sourceId: { type: "string", description: "Source ID from list_sources" }, query: { type: "string", description: "Search query" } }, required: ["sourceId", "query"] } } },
  { type: "function", function: { name: "list_categories",   description: "List the user's library categories and manga counts.",                                                                                                                      parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_library",      description: "List manga in the user's library, optionally filtered by category.",                                                                                                       parameters: { type: "object", properties: { categoryId: { type: "string", description: "Category ID to filter by (optional)" } } } } },
  { type: "function", function: { name: "create_category",   description: "Create a new category in the user's library.",                                                                                                                             parameters: { type: "object", properties: { name: { type: "string", description: "Name for the new category" } }, required: ["name"] } } },
  { type: "function", function: { name: "delete_category",   description: "Delete a user category. DESTRUCTIVE — requires user permission. Always use this tool; the UI shows a confirmation button the user must click before deletion proceeds.",    parameters: { type: "object", properties: { categoryId: { type: "string", description: "Category ID to delete" }, categoryName: { type: "string", description: "Category name for display" } }, required: ["categoryId", "categoryName"] } } },
  { type: "function", function: { name: "move_manga_category", description: "Move a manga from its current category to a different category.",                                                                                                        parameters: { type: "object", properties: { mangaId: { type: "string", description: "Manga ID" }, targetCategoryId: { type: "string", description: "Target category ID" } }, required: ["mangaId", "targetCategoryId"] } } },
];

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Comi AI — the smart assistant built into Comix Lounge, a manga reader app.

You have tools to:
- List, browse, and search all available manga sources (even ones the user hasn't installed)
- Manage the user's library categories (create, delete, move manga between categories)
- Recommend manga based on what the user asks for

BEHAVIOR RULES:
0. For greetings, small talk, or questions not related to manga/library — reply conversationally WITHOUT calling any tools.
1. When a user asks for recommendations or wants to find manga: call list_sources first, pick the most relevant source(s), then call search_manga or browse_popular.
2. When managing categories: call list_categories first to see what exists.
3. For DELETE actions: always call delete_category — never tell the user you deleted something without using the tool. The UI shows a permission button the user must click.
4. For MOVE actions: first call list_categories to get IDs, then call move_manga_category.
5. Present manga results in a clean readable list (title, type if available).
6. Be conversational, helpful, and knowledgeable about manga, manhwa, manhua, and hentai/adult titles when asked.
7. Always maintain continuity from previous messages.
8. Never call the same tool twice in a row with the same arguments.`;

// ── Route ────────────────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  const { messages: rawMessages, modelMode = "auto" } = req.body as {
    messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>;
    modelMode: string;
  };

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const fullText = rawMessages.map(m => String(m.content ?? "")).join(" ").toLowerCase();
  const queue = buildQueue(modelMode, fullText);

  const apiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...rawMessages,
  ];

  let lastError = "No API keys are configured.";

  for (const provider of queue) {
    if (!provider.key) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const aiRes = await fetch(provider.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.key}` },
        body: JSON.stringify({
          model: provider.model,
          messages: apiMessages,
          tools: provider.isUncensored ? undefined : TOOLS,
          tool_choice: provider.isUncensored ? undefined : "auto",
          temperature: provider.isUncensored ? 0.7 : 0.3,
          max_tokens: 1500,
        }),
        signal: controller.signal,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`${aiRes.status} — ${errText.slice(0, 300)}`);
      }

      const data = await aiRes.json() as any;
      const choice = data.choices?.[0];
      const content: string | null = choice?.message?.content ?? null;

      if (isBlocked(content)) {
        throw new Error(`Content blocked by ${provider.name} alignment filter.`);
      }

      res.json({
        content,
        tool_calls: choice?.message?.tool_calls ?? null,
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
