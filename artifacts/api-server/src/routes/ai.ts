import { Router } from "express";

const router = Router();

const FETCH_TIMEOUT_MS = 65_000;

const GROQ_KEY     = () => process.env["GROQ_API_KEY"]        ?? "";
const OPENROUTER_KEY = () => process.env["OPENROUTER_API_KEY"] ?? "";
const GEMINI_KEY   = () => process.env["GEMINI_API_KEY"]       ?? "";

const ALL_PROVIDERS = [
  {
    name: "Groq",
    type: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: GROQ_KEY,
    model: "llama-3.3-70b-versatile",
    isUncensored: false,
  },
  {
    name: "OpenRouter Nex",
    type: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: OPENROUTER_KEY,
    model: "nex-agi/nex-n2-pro:free",
    isUncensored: false,
  },
  {
    name: "Gemini",
    type: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: GEMINI_KEY,
    model: "gemini-2.5-flash",
    isUncensored: false,
  },
  {
    name: "OpenRouter Uncensored",
    type: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: OPENROUTER_KEY,
    model: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    isUncensored: true,
  },
];

const TOOLS = [
  { type: "function", function: { name: "list_sources", description: "List all available manga sources/extensions that can be browsed (even if not installed by the user).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "browse_popular", description: "Browse popular/trending manga from a specific source.", parameters: { type: "object", properties: { sourceId: { type: "string", description: "Source ID from list_sources" } }, required: ["sourceId"] } } },
  { type: "function", function: { name: "search_manga", description: "Search for manga by title or keyword in a specific source.", parameters: { type: "object", properties: { sourceId: { type: "string", description: "Source ID from list_sources" }, query: { type: "string", description: "Search query" } }, required: ["sourceId", "query"] } } },
  { type: "function", function: { name: "list_categories", description: "List the user's library categories and manga counts.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_library", description: "List manga in the user's library, optionally filtered by category.", parameters: { type: "object", properties: { categoryId: { type: "string", description: "Category ID to filter by (optional)" } } } } },
  { type: "function", function: { name: "create_category", description: "Create a new category in the user's library.", parameters: { type: "object", properties: { name: { type: "string", description: "Name for the new category" } }, required: ["name"] } } },
  { type: "function", function: { name: "delete_category", description: "Delete a user category. DESTRUCTIVE — requires user permission. Always use this tool; never skip it. The UI will show a permission button that the user must click before deletion proceeds.", parameters: { type: "object", properties: { categoryId: { type: "string", description: "Category ID to delete" }, categoryName: { type: "string", description: "Category name for display" } }, required: ["categoryId", "categoryName"] } } },
  { type: "function", function: { name: "move_manga_category", description: "Move a manga from its current category to a different category.", parameters: { type: "object", properties: { mangaId: { type: "string", description: "Manga ID" }, targetCategoryId: { type: "string", description: "Target category ID" } }, required: ["mangaId", "targetCategoryId"] } } },
];

const SYSTEM_PROMPT = `You are Comi AI — the smart assistant built into Comix Lounge, a manga reader app.

You have tools to:
- List, browse, and search all available manga sources (even ones the user hasn't installed)
- Manage the user's library categories (create, delete, move manga between categories)
- Recommend manga based on what the user asks for

BEHAVIOR RULES:
1. When a user asks for recommendations or wants to find manga: call list_sources first, pick the most relevant source(s), then call search_manga or browse_popular.
2. When managing categories: call list_categories first to see what exists.
3. For DELETE actions: always call delete_category — never tell the user you deleted something without using the tool. The UI shows a permission button the user must click.
4. For MOVE actions: first call list_categories to get IDs, then call move_manga_category.
5. Present manga results in a clean readable list (title, type if available).
6. Be conversational, helpful, and knowledgeable about manga, manhwa, manhua.
7. Always maintain continuity from previous messages.`;

function buildQueue(modelMode: string, fullText: string) {
  const adultWords = ["hentia", "hentai", "18+", "nsfw", "xxx", "erotic", "adult", "smut", "lewd", "ecchi"];
  const isAdult = adultWords.some(w => fullText.includes(w));

  if (modelMode === "uncensored" || (modelMode === "auto" && isAdult)) {
    return [...ALL_PROVIDERS.filter(p => p.isUncensored), ...ALL_PROVIDERS.filter(p => !p.isUncensored)];
  }
  if (modelMode !== "auto") {
    const prio = ALL_PROVIDERS.filter(p => p.type === modelMode);
    const rest = ALL_PROVIDERS.filter(p => p.type !== modelMode);
    return [...prio, ...rest];
  }
  return [...ALL_PROVIDERS.filter(p => !p.isUncensored), ...ALL_PROVIDERS.filter(p => p.isUncensored)];
}

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

  let lastError = "No API keys configured.";

  for (const provider of queue) {
    const key = provider.key();
    if (!key) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const aiRes = await fetch(provider.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({
          model: provider.model,
          messages: apiMessages,
          tools: provider.isUncensored ? undefined : TOOLS,
          tool_choice: provider.isUncensored ? undefined : "auto",
          temperature: provider.isUncensored ? 0.6 : 0.3,
          max_tokens: 1500,
        }),
        signal: controller.signal,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`${aiRes.status} — ${errText.slice(0, 200)}`);
      }

      const data = await aiRes.json() as any;
      const choice = data.choices?.[0];
      const content: string | null = choice?.message?.content ?? null;

      if (content && (content.includes("I cannot assist with") || content.includes("I am unable to provide"))) {
        throw new Error("Content blocked by alignment filter.");
      }

      res.json({ content, tool_calls: choice?.message?.tool_calls ?? null, provider: provider.name });
      return;
    } catch (err: any) {
      lastError = err.message ?? String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  res.status(502).json({ error: `All AI providers failed. Last: ${lastError}` });
});

export default router;
