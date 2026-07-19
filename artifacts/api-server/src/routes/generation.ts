// routes/generation.ts
import { Router, type Request, type Response } from "express";
import { getSourceOrNull } from "../sources/registry";
import { logger } from "../lib/logger";

const router = Router();

const OPENAI_KEY = () => process.env.OPENAI_API_KEY ?? "";
const GROQ_KEY = () => {
  const k = process.env.GROQ_API_KEY ?? "";
  return k;
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function callDalle(prompt: string): Promise<{ url: string; revised: string }> {
  const key = OPENAI_KEY();
  if (!key) throw new Error("OPENAI_API_KEY is not set on the server.");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "url",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `DALL-E error ${res.status}: ${JSON.stringify(err)}`
    );
  }

  const data = (await res.json()) as { data: { url: string; revised_prompt: string }[] };
  return { url: data.data[0].url, revised: data.data[0].revised_prompt ?? prompt };
}

async function callGroqJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const key = GROQ_KEY();
  if (!key) throw new Error("GROQ_API_KEY is not set on the server.");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq error ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content) as T;
}

// ── POST /api/generation/draw ─────────────────────────────────────────────────
router.post("/draw", async (req: Request, res: Response) => {
  try {
    const { prompt, style } = req.body as { prompt?: string; style?: string };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    // Enhance the prompt with an artistic style prefix
    const styleTag = style ? `, ${style} style` : ", manga art style, highly detailed, professional illustration";
    const enhancedPrompt = `${prompt.trim()}${styleTag}`;

    const { url, revised } = await callDalle(enhancedPrompt);
    res.json({ imageUrl: url, revisedPrompt: revised, originalPrompt: prompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "generation/draw error");
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/generation/animate ─────────────────────────────────────────────
// Returns an image + animation parameters so the frontend canvas can animate it
router.post("/animate", async (req: Request, res: Response) => {
  try {
    const { description } = req.body as { description?: string };
    if (!description?.trim()) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    // Step 1: parse the description with Groq to get animation metadata
    type AnimMeta = {
      imagePrompt: string;
      animationType: string;
      direction: string;
      speed: string;
      bgColor: string;
    };

    const meta = await callGroqJson<AnimMeta>(
      `You are an animation parser for a manga reader app. 
Given an animation description, return JSON with exactly these keys:
- imagePrompt: a DALL-E image generation prompt for a clear, full-body character or scene in the described action pose. Include "white background, manga art style, clean line art, full body shot" to ensure it animates well.
- animationType: one of walk|jump|fight|idle|fly|spin|shake|run
- direction: one of right|left|up|down|none  
- speed: one of slow|normal|fast
- bgColor: a CSS hex color for the animation background (dark theme friendly, e.g. "#1a1a2e")

Return valid JSON only.`,
      `Animation request: "${description.trim()}"`
    );

    // Step 2: generate the image with DALL-E
    const { url, revised } = await callDalle(meta.imagePrompt);

    res.json({
      imageUrl: url,
      revisedPrompt: revised,
      originalDescription: description,
      animationType: meta.animationType ?? "idle",
      direction: meta.direction ?? "none",
      speed: meta.speed ?? "normal",
      bgColor: meta.bgColor ?? "#1a1a2e",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "generation/animate error");
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/generation/analyze-manga ───────────────────────────────────────
// Fetches manga metadata + analyzes a few pages, stores in knowledge base concept
router.post("/analyze-manga", async (req: Request, res: Response) => {
  try {
    const { sourceId, mangaId, mangaUrl } = req.body as {
      sourceId?: string;
      mangaId?: string;
      mangaUrl?: string;
    };

    const allowedSources = ["en.ninehentai", "all.thunderscans"];
    if (!sourceId || !allowedSources.includes(sourceId)) {
      res.status(400).json({
        error: `sourceId must be one of: ${allowedSources.join(", ")}`,
      });
      return;
    }
    if (!mangaId && !mangaUrl) {
      res.status(400).json({ error: "mangaId or mangaUrl is required" });
      return;
    }

    const source = getSourceOrNull(sourceId);
    if (!source) {
      res.status(404).json({ error: `Source "${sourceId}" not found or not loaded` });
      return;
    }

    // Fetch manga details
    const id = mangaId ?? mangaUrl ?? "";
    const details = await source.getMangaDetails(id);

    // Fetch chapter list
    const chapters = await source.getChapterList(id);
    const firstChapter = chapters[chapters.length - 1]; // oldest chapter first

    let pageUrls: string[] = [];
    if (firstChapter) {
      try {
        const pages = await source.getChapterPages(firstChapter.id);
        pageUrls = pages.slice(0, 4).map((p) => p.url);
      } catch (_) {
        // page fetch failing is non-fatal
      }
    }

    // Analyze pages with Groq vision (llama-4 scout has vision)
    const pageAnalyses: string[] = [];
    const GROQ_VISION_KEY = GROQ_KEY();

    for (const pageUrl of pageUrls.slice(0, 3)) {
      try {
        const visionRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GROQ_VISION_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Describe this manga page: what actions are happening, what text/dialogue is visible, the art style, mood, and setting. Be concise (2-3 sentences).",
                  },
                  { type: "image_url", image_url: { url: pageUrl } },
                ],
              },
            ],
            max_tokens: 300,
          }),
        });

        if (visionRes.ok) {
          const vd = (await visionRes.json()) as { choices: { message: { content: string } }[] };
          pageAnalyses.push(vd.choices[0]?.message?.content ?? "");
        }
      } catch (_) {
        // vision error is non-fatal
      }
    }

    // Build the knowledge entry
    const knowledgeEntry = {
      source_id: sourceId,
      manga_id: id,
      title: details.title,
      author: details.author ?? "",
      status: details.status ?? "",
      description: details.desc ?? "",
      tags: (details.tags ?? []).map((t: { name?: string } | string) =>
        typeof t === "string" ? t : t.name ?? ""
      ),
      chapter_count: chapters.length,
      page_analyses: pageAnalyses,
      analyzed_at: new Date().toISOString(),
    };

    // Try to persist to Supabase if available
    let stored = false;
    try {
      const { getSupabase } = await import("../lib/supabase");
      const sb = getSupabase();
      const { error } = await sb
        .from("manga_knowledge")
        .upsert(knowledgeEntry, { onConflict: "source_id,manga_id" });
      if (!error) stored = true;
    } catch (_) {
      // Supabase not available — return result without storing
    }

    res.json({
      stored,
      title: details.title,
      tags: knowledgeEntry.tags,
      description: knowledgeEntry.description,
      chapterCount: chapters.length,
      pagesAnalyzed: pageAnalyses.length,
      pageAnalyses,
      setupSql: stored
        ? undefined
        : `-- Run this in your Supabase SQL editor to enable knowledge storage:
CREATE TABLE IF NOT EXISTS manga_knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id TEXT NOT NULL,
  manga_id TEXT NOT NULL,
  title TEXT,
  author TEXT,
  status TEXT,
  description TEXT,
  tags TEXT[],
  chapter_count INTEGER,
  page_analyses TEXT[],
  analyzed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, manga_id)
);`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "generation/analyze-manga error");
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/generation/knowledge/stats ──────────────────────────────────────
router.get("/knowledge/stats", async (_req: Request, res: Response) => {
  try {
    const { getSupabase } = await import("../lib/supabase");
    const sb = getSupabase();
    const { count, error } = await sb
      .from("manga_knowledge")
      .select("*", { count: "exact", head: true });

    if (error) throw error;
    res.json({ totalManga: count ?? 0, status: "ok" });
  } catch (_) {
    // Table may not exist yet
    res.json({ totalManga: 0, status: "table_not_created" });
  }
});

export default router;
