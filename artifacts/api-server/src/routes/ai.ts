import { Router } from "express";

const router = Router();

const FETCH_TIMEOUT_MS = 65_000;

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
  "nousresearch/hermes-3-llama-3.1-70b:free",
];

function buildProviders() {
  const groqKeys       = collectKeys("GROQ_API_KEY");
  const geminiKeys     = collectKeys("GEMINI_API_KEY");
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
      name: i > 0 ? `OpenRouter Nex (key ${i + 1})` : "OpenRouter Nex",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouterKeys[i],
      model: "nex-agi/nex-n2-pro:free",
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

// ── FIX 1: Only check the LATEST user message, not full history ──────────────
function isAdultContext(messages: Array<{ role: string; content: string | null }>): boolean {
  // Find the last user message only
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const text = String(messages[i].content ?? "").toLowerCase();
      return ADULT_WORDS.some(w => text.includes(w));
    }
  }
  return false;
}

function buildQueue(modelMode: string, isAdult: boolean) {
  const all        = buildProviders();
  const normal     = all.filter(p => !p.isUncensored);
  const uncensored = all.filter(p =>  p.isUncensored);

  if (modelMode === "uncensored") {
    return [...uncensored];
  }
  if (modelMode === "auto" && isAdult) {
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

// ── FIX 2: Sanitize messages to prevent crash on reload ──────────────────────
function sanitizeMessages(
  messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>
) {
  const sanitized = [];
  for (const msg of messages) {
    // Keep tool_calls on assistant messages, keep tool results
    if (msg.role === "assistant") {
      const entry: any = { role: "assistant", content: msg.content ?? null };
      if (msg.tool_calls?.length) entry.tool_calls = msg.tool_calls;
      sanitized.push(entry);
    } else if (msg.role === "tool") {
      // Must have a preceding assistant message with tool_calls — keep as-is
      sanitized.push({
        role: "tool",
        tool_call_id: msg.tool_call_id ?? "unknown",
        name: msg.name ?? "unknown",
        content: String(msg.content ?? ""),
      });
    } else if (msg.role === "user") {
      sanitized.push({ role: "user", content: String(msg.content ?? "") });
    }
    // Drop any unknown roles silently
  }

  // Safety: if the array starts with a tool result or has orphaned tool results, strip them
  // (tool result must always follow an assistant message that has tool_calls)
  const cleaned = [];
  for (let i = 0; i < sanitized.length; i++) {
    const msg = sanitized[i];
    if (msg.role === "tool") {
      const prev = cleaned[cleaned.length - 1];
      if (!prev || prev.role !== "assistant" || !prev.tool_calls?.length) {
        continue; // orphaned tool result — skip
      }
    }
    cleaned.push(msg);
  }

  return cleaned;
}

// ── FEATURE: Expanded tool definitions ───────────────────────────────────────
const TOOLS = [
  // ── Source & discovery ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "list_sources",
      description: "List all available manga/manhwa/manhua sources and extensions that can be browsed, including adult/18+ sources.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "browse_popular",
      description: "Browse popular or trending titles from a specific source.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Source ID from list_sources" },
          page:     { type: "number", description: "Page number (default 1)" },
        },
        required: ["sourceId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browse_latest",
      description: "Browse the latest updated titles from a specific source.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Source ID from list_sources" },
          page:     { type: "number", description: "Page number (default 1)" },
        },
        required: ["sourceId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_manga",
      description: "Search for manga/manhwa by title or keyword within a specific source.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Source ID from list_sources" },
          query:    { type: "string", description: "Search query" },
          page:     { type: "number", description: "Page number (default 1)" },
        },
        required: ["sourceId", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "global_search",
      description: "Search across ALL installed sources at once for a title or keyword. Use when the user wants broad results or doesn't specify a source.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browse_by_tag",
      description: "Browse or filter manga by genre/tag within a specific source (e.g. 'hentai', 'romance', 'action', 'ecchi').",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Source ID from list_sources" },
          tag:      { type: "string", description: "Tag or genre name to filter by" },
          page:     { type: "number", description: "Page number (default 1)" },
        },
        required: ["sourceId", "tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_manga_details",
      description: "Get full details for a specific manga: description, genres, status, author, and chapter list.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Source ID" },
          mangaId:  { type: "string", description: "Manga ID from search or browse results" },
        },
        required: ["sourceId", "mangaId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_chapters",
      description: "Get the chapter list for a specific manga.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Source ID" },
          mangaId:  { type: "string", description: "Manga ID" },
        },
        required: ["sourceId", "mangaId"],
      },
    },
  },
  // ── Library management ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "list_categories",
      description: "List the user's library categories and how many manga are in each.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_library",
      description: "List manga in the user's library, optionally filtered by category.",
      parameters: {
        type: "object",
        properties: {
          categoryId: { type: "string", description: "Category ID to filter by (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_library",
      description: "Add a manga to the user's library, optionally into a specific category.",
      parameters: {
        type: "object",
        properties: {
          sourceId:   { type: "string", description: "Source ID" },
          mangaId:    { type: "string", description: "Manga ID to add" },
          categoryId: { type: "string", description: "Category ID to add into (optional)" },
        },
        required: ["sourceId", "mangaId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_category",
      description: "Create a new library category.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for the new category" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_category",
      description: "Delete a user category. DESTRUCTIVE — the UI shows a confirmation the user must click before deletion proceeds.",
      parameters: {
        type: "object",
        properties: {
          categoryId:   { type: "string", description: "Category ID to delete" },
          categoryName: { type: "string", description: "Category name for display" },
        },
        required: ["categoryId", "categoryName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_manga_category",
      description: "Move a manga from its current category to a different one.",
      parameters: {
        type: "object",
        properties: {
          mangaId:        { type: "string", description: "Manga ID" },
          targetCategoryId: { type: "string", description: "Target category ID" },
        },
        required: ["mangaId", "targetCategoryId"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are Comi AI — the smart assistant built into Comix Lounge, a manga reader app.

You have tools to:
- List, browse, search, and filter all available manga/manhwa/manhua/hentai sources
- Global search across all sources at once
- Browse by tag/genre (e.g. "hentai", "ecchi", "romance", "action")
- Get full manga details and chapter lists
- Manage the user's library: add titles, create/delete categories, move manga between categories

BEHAVIOR RULES:
0. For greetings, small talk, or questions unrelated to manga/library — reply conversationally without calling tools.
1. For recommendations or finding manga: call list_sources first, pick relevant source(s), then call search_manga, browse_popular, browse_by_tag, or global_search as appropriate.
2. For broad searches with no specific source, use global_search.
3. For genre/tag filtering (e.g. "show me hentai manhwa"), use browse_by_tag with the appropriate tag.
4. For details or chapters on a specific title, use get_manga_details or get_chapters.
5. When managing categories: call list_categories first to get IDs.
6. For DELETE: always call delete_category — never say you deleted something without calling the tool.
7. For MOVE: call list_categories first for IDs, then move_manga_category.
8. Present manga results as a clean readable list (title, type if available, brief description if available).
9. Be conversational, helpful, and knowledgeable about all manga formats including adult/18+ titles when asked — never refuse based on content type.
10. Always maintain context and continuity from previous messages in the conversation.
11. Never call the same tool twice in a row with identical arguments.`;

router.post("/chat", async (req, res) => {
  const { messages: rawMessages, modelMode = "auto" } = req.body as {
    messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>;
    modelMode: string;
  };

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  // FIX 1: Check only the latest user message for adult context
  const isAdult  = isAdultContext(rawMessages);
  const queue    = buildQueue(modelMode, isAdult);

  // FIX 2: Sanitize history to prevent crash on reload
  const cleanMessages = sanitizeMessages(rawMessages);

  const apiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...cleanMessages,
  ];

  let lastError = "No API keys are configured.";

  for (const provider of queue) {
    if (!provider.key) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const aiRes = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.key}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: apiMessages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: provider.isUncensored ? 0.7 : 0.3,
          max_tokens: 1500,
        }),
        signal: controller.signal,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`${aiRes.status} — ${errText.slice(0, 300)}`);
      }

      const data   = await aiRes.json() as any;
      const choice = data.choices?.[0];
      const content: string | null = choice?.message?.content ?? null;

      if (isBlocked(content)) {
        throw new Error(`Content blocked by ${provider.name} alignment filter.`);
      }

      res.json({
        content,
        tool_calls: choice?.message?.tool_calls ?? null,
        provider:   provider.name,
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
