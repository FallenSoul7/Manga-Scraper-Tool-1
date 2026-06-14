import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

async function callGroq(messages: any[], model = "llama-3.3-70b-versatile", opts: Record<string, unknown> = {}) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set. Add it in Secrets.");
  const res = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1000, ...opts }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error: ${err}`);
  }
  return res.json();
}

// POST /api/ai/chat — router that decides intent
router.post("/ai/chat", async (req: Request, res: Response) => {
  try {
    const { messages, hasFile } = req.body;
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: "messages must be an array" });
      return;
    }

    const systemPrompt = `You are the Comi AI — an expert manga assistant for the Comix Lounge reader app.
You have encyclopedic knowledge of manga, manhwa, manhua, and the Tachimanga/Mihon backup format.

YOUR JOB: Analyze the user's latest request and decide what to do. Respond in STRICT valid JSON.

Format:
{
  "intent": "CHAT" | "FULL_DB_SCAN",
  "response": "Your conversational reply to the user.",
  "command": "If FULL_DB_SCAN, extract the user's sorting rule here. Otherwise leave empty."
}

INTENT RULES:
1. "CHAT": Use for greetings, general manga questions, or when no file is attached.
2. "FULL_DB_SCAN": Use ONLY when the user explicitly wants to organize/sort their library AND a file is attached (${hasFile ? "A FILE IS ATTACHED." : "NO file attached — use CHAT."}).`;

    const clean = messages.map((m: any) => ({ role: m.role, content: m.content }));
    clean.unshift({ role: "system", content: systemPrompt });

    const completion = await callGroq(clean, "llama-3.3-70b-versatile", {
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0].message?.content;
    if (!raw) throw new Error("Empty response from AI");

    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (e: any) {
    res.json({
      intent: "CHAT",
      response: `Sorry, I hit an error: ${e.message}`,
    });
  }
});

// POST /api/ai/sort — batch manga categorisation (stateless, no Supabase needed)
// Sessions are stored in-memory on the server (works for single-instance dev)
const sessions = new Map<string, any[]>();

router.post("/ai/sort", async (req: Request, res: Response) => {
  try {
    const { action, command, cursor = 0, existingCategories = {}, sessionKey } = req.body;

    if (action === "init") {
      // For now return a placeholder — full DB parsing requires sql.js wasm
      // which needs a different setup in Node. Return a helpful message.
      res.status(501).json({
        error: "Full DB scan requires Groq + Supabase keys. Please set GROQ_API_KEY and deploy the Tachi-ai backend separately, then point this app at it.",
      });
      return;
    }

    if (action === "batch" && sessionKey) {
      const manga = sessions.get(sessionKey);
      if (!manga) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const BATCH = 40;
      const batch = manga.slice(cursor, cursor + BATCH);
      const nextCursor = cursor + BATCH;
      const isDone = nextCursor >= manga.length;

      const systemPrompt = `You are an expert manga categorisation AI. Return ONLY valid JSON: { "Category Name": [id1, id2, ...] }. Every ID must be assigned. No markdown.
${Object.keys(existingCategories).length > 0 ? `Reuse these existing category names when possible: ${Object.keys(existingCategories).join(", ")}` : ""}`;

      const completion = await callGroq([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Command: "${command}"\n\nBatch:\n${JSON.stringify(batch, null, 2)}\n\nReturn JSON only.` },
      ], "llama-3.3-70b-versatile", { max_tokens: 4000 });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: Record<string, number[]> = {};
      try {
        const match = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim().match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch (_) {
        parsed = {};
      }

      const merged: Record<string, number[]> = { ...existingCategories };
      for (const [cat, ids] of Object.entries(parsed)) {
        if (!merged[cat]) merged[cat] = [];
        merged[cat].push(...(ids as number[]));
      }

      if (!isDone) {
        res.json({ status: "processing", nextCursor, categories: merged, totalManga: manga.length });
        return;
      }

      sessions.delete(sessionKey);
      res.json({ status: "done", resultFileName: "sorted_categories.json", totalCategories: Object.keys(merged).length, categories: merged });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
