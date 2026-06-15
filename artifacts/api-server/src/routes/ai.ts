import { Router } from "express";
import type { IRouter, Request, Response } from "express";
import { gunzipSync } from "zlib";

const router: IRouter = Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

async function callGroq(
  messages: any[],
  model = "llama-3.3-70b-versatile",
  opts: Record<string, unknown> = {},
): Promise<any> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set. Add it in Secrets.");
  const res = await fetch(GROQ_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1000, ...opts }),
  });
  if (!res.ok) throw new Error(`Groq API error: ${await res.text()}`);
  return res.json() as Promise<any>;
}

// ── Minimal protobuf varint reader ─────────────────────────────────────────
function readVarint(buf: Buffer, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  while (p < buf.length) {
    const byte = buf[p++]!;
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) break;
  }
  return [result, p];
}

// Parse a single BackupManga message.
// From Mihon source: field 3 = title (string), field 7 = genre (repeated string)
function parseBackupManga(buf: Buffer): { title: string; genres: string[] } {
  let pos = 0;
  let title = "";
  const genres: string[] = [];
  while (pos < buf.length) {
    let tag: bigint, p: number;
    try { [tag, p] = readVarint(buf, pos); } catch { break; }
    pos = p;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const data = buf.subarray(pos, pos + Number(len));
      pos += Number(len);
      if (fieldNum === 3) title = data.toString("utf-8");
      else if (fieldNum === 7) genres.push(data.toString("utf-8"));
    } else if (wireType === 0) { const [, p2] = readVarint(buf, pos); pos = p2; }
    else if (wireType === 1) { pos += 8; }
    else if (wireType === 5) { pos += 4; }
    else break;
  }
  return { title, genres };
}

// Parse a Mihon .tachibk / .tmb backup.
// Outer Backup message: field 1 = repeated BackupManga.
// File may be raw protobuf or gzip-wrapped protobuf (magic bytes 0x1f 0x8b).
function parseMihonBackup(rawBuf: Buffer): Array<{ id: number; title: string; genres: string[] }> {
  let buf = rawBuf;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = gunzipSync(buf);
  }
  const mangas: Array<{ id: number; title: string; genres: string[] }> = [];
  let pos = 0;
  let idx = 0;
  while (pos < buf.length) {
    let tag: bigint, p: number;
    try { [tag, p] = readVarint(buf, pos); } catch { break; }
    pos = p;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const data = buf.subarray(pos, pos + Number(len));
      pos += Number(len);
      if (fieldNum === 1) {
        const m = parseBackupManga(data);
        if (m.title) mangas.push({ id: idx++, title: m.title, genres: m.genres });
      }
    } else if (wireType === 0) { const [, p2] = readVarint(buf, pos); pos = p2; }
    else if (wireType === 1) { pos += 8; }
    else if (wireType === 5) { pos += 4; }
    else break;
  }
  return mangas;
}

// Parse a Tachiyomi .db (SQLite) file.
// Schema from Mihon source: mangas table, favorite=1 rows are library entries.
// genre column is a comma-separated string.
async function parseSQLiteDB(
  buf: Buffer,
): Promise<Array<{ id: number; title: string; genres: string[] }>> {
  // @ts-ignore — sql.js ships no .d.ts; types are handled at runtime via any
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(buf));
  try {
    const results = db.exec(
      `SELECT _id, title, COALESCE(genre,'') AS genre FROM mangas WHERE favorite = 1 ORDER BY title`,
    );
    if (!results.length || !results[0]) return [];
    return results[0].values.map((row: any[]) => ({
      id: Number(row[0]),
      title: String(row[1] ?? ""),
      genres: row[2] ? String(row[2]).split(", ").filter(Boolean) : [],
    }));
  } finally {
    db.close();
  }
}

// ── In-memory session + result stores ─────────────────────────────────────
const sessions = new Map<string, Array<{ id: number; title: string; genres: string[] }>>();
const downloadResults = new Map<string, string>(); // filename → JSON string

function makeKey() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── POST /api/ai/chat ──────────────────────────────────────────────────────
router.post("/ai/chat", async (req: Request, res: Response) => {
  try {
    const { messages, hasFile } = req.body;
    if (!Array.isArray(messages)) { res.status(400).json({ error: "messages must be an array" }); return; }

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
    res.json(JSON.parse(raw));
  } catch (e: any) {
    res.json({ intent: "CHAT", response: `Sorry, I hit an error: ${e.message}` });
  }
});

// ── POST /api/ai/sort ──────────────────────────────────────────────────────
router.post("/ai/sort", async (req: Request, res: Response) => {
  try {
    const {
      action,
      command,
      cursor = 0,
      existingCategories = {},
      sessionKey,
      fileData,   // base64-encoded raw file bytes sent by the frontend
      fileName,   // original filename, used to detect format (.db vs .tachibk/.tmb)
    } = req.body;

    // ── INIT: parse the uploaded backup, create a session ─────────────────
    if (action === "init") {
      if (!fileData) {
        res.status(400).json({ error: "No file data received. Please re-attach your backup." });
        return;
      }
      const buf = Buffer.from(fileData, "base64");
      const ext = String(fileName ?? "").toLowerCase();

      let manga: Array<{ id: number; title: string; genres: string[] }>;
      try {
        manga = ext.endsWith(".db") ? await parseSQLiteDB(buf) : parseMihonBackup(buf);
      } catch (err: any) {
        res.status(400).json({ error: `Could not parse "${fileName}": ${err.message}` });
        return;
      }

      if (manga.length === 0) {
        res.status(400).json({
          error:
            "No library manga found in this file. Make sure it is a Tachimanga .db or a Mihon .tachibk/.tmb backup.",
        });
        return;
      }

      const key = makeKey();
      sessions.set(key, manga);
      res.json({ totalManga: manga.length, sessionKey: key });
      return;
    }

    // ── BATCH: categorise a slice using Groq ──────────────────────────────
    if (action === "batch" && sessionKey) {
      const manga = sessions.get(sessionKey);
      if (!manga) { res.status(404).json({ error: "Session not found or expired." }); return; }

      const BATCH = 40;
      const batch = manga.slice(cursor, cursor + BATCH);
      const nextCursor = cursor + BATCH;
      const isDone = nextCursor >= manga.length;

      const systemPrompt = `You are an expert manga categorisation AI. Return ONLY valid JSON: { "Category Name": [id1, id2, ...] }. Every ID in the batch must appear in exactly one category. No markdown.
${Object.keys(existingCategories).length > 0 ? `Reuse these existing category names when appropriate: ${Object.keys(existingCategories).join(", ")}` : ""}`;

      const completion = await callGroq(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Command: "${command}"\n\nBatch:\n${JSON.stringify(batch, null, 2)}\n\nReturn JSON only.`,
          },
        ],
        "llama-3.3-70b-versatile",
        { max_tokens: 4000 },
      );

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: Record<string, number[]> = {};
      try {
        const match = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim().match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : raw);
      } catch (_) { /* keep empty */ }

      const merged: Record<string, number[]> = { ...existingCategories };
      for (const [cat, ids] of Object.entries(parsed)) {
        if (!merged[cat]) merged[cat] = [];
        merged[cat].push(...(ids as number[]));
      }

      if (!isDone) {
        res.json({ status: "processing", nextCursor, categories: merged, totalManga: manga.length });
        return;
      }

      // All batches done — build human-readable result (id → title)
      sessions.delete(sessionKey);
      const idToTitle = Object.fromEntries(manga.map((m) => [m.id, m.title]));
      const namedCategories: Record<string, string[]> = {};
      for (const [cat, ids] of Object.entries(merged)) {
        namedCategories[cat] = (ids as number[]).map((id) => idToTitle[id] ?? String(id));
      }

      const resultKey = makeKey();
      const resultFileName = `sorted_${resultKey}.json`;
      downloadResults.set(resultFileName, JSON.stringify(namedCategories, null, 2));

      res.json({
        status: "done",
        resultFileName,
        totalCategories: Object.keys(namedCategories).length,
        categories: merged,
      });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/ai/download?file=sorted_xxx.json ──────────────────────────────
router.get("/ai/download", (req: Request, res: Response) => {
  const file = String(req.query.file ?? "");
  const data = downloadResults.get(file);
  if (!data) { res.status(404).json({ error: "Result not found or expired." }); return; }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
  res.send(data);
});

export default router;
