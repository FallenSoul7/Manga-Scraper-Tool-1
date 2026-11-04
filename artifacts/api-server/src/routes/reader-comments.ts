import { createHash } from "node:crypto";
import { Router } from "express";

const router = Router();
const MAX_COMMENT_LENGTH = 2000;
const MAX_TITLE_ALIASES = 12;
const MAX_COMMENTS = 100;

interface DbCell {
  type: string;
  value?: string;
  base64?: string;
}
interface DbResult {
  cols: Array<{ name: string }>;
  rows: DbCell[][];
  last_insert_rowid?: string | number | null;
  affected_row_count?: number;
}
interface SqlStatement {
  sql: string;
  args?: Array<string | number>;
}
interface ReaderScope {
  title: string;
  aliases: string[];
  chapterKey: string;
  chapterLabel: string;
  sourceId: string;
  chapterId: string;
}

function getEndpoint(): string {
  let base = (process.env["TURSO_DATABASE_URL"] ?? "").trim();
  if (!base) throw new Error("Turso comments database is not configured.");
  if (base.startsWith("libsql://")) base = `https://${base.slice("libsql://".length)}`;
  if (base.startsWith("turso://")) base = `https://${base.slice("turso://".length)}`;
  const url = new URL(base);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/v2/pipeline") ? pathname : `${pathname}/v2/pipeline`;
  url.search = "";
  return url.toString();
}

function isConfigured(): boolean {
  return !!process.env["TURSO_DATABASE_URL"]?.trim() && !!process.env["TURSO_AUTH_TOKEN"]?.trim();
}

async function runSql(statements: SqlStatement[]): Promise<DbResult[]> {
  const token = process.env["TURSO_AUTH_TOKEN"]?.trim();
  if (!token) throw new Error("Turso comments database is not configured.");
  const requests = statements.map(({ sql, args }) => ({
    type: "execute",
    stmt: {
      sql,
      ...(args?.length ? {
        args: args.map((value) => typeof value === "number"
          ? { type: Number.isInteger(value) ? "integer" : "float", value: String(value) }
          : { type: "text", value }),
      } : {}),
    },
  }));
  requests.push({ type: "close" } as any);
  const response = await fetch(getEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Turso request failed (${response.status}).`);
  const payload = await response.json() as {
    results?: Array<{ type?: string; error?: { message?: string }; response?: { result?: DbResult } }>;
  };
  const results = payload.results ?? [];
  const failed = results.find((entry) => entry.type !== "ok");
  if (failed) throw new Error(failed.error?.message || "Turso query failed.");
  return results.flatMap((entry) => entry.response?.result ? [entry.response.result] : []);
}

const SCHEMA_STATEMENTS: SqlStatement[] = [
  {
    sql: `CREATE TABLE IF NOT EXISTS reader_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manga_title TEXT NOT NULL,
      manga_aliases TEXT NOT NULL CHECK (json_valid(manga_aliases)),
      chapter_key TEXT NOT NULL,
      chapter_label TEXT NOT NULL,
      source_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL
    )`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS reader_comment_likes (
      comment_id INTEGER NOT NULL,
      voter_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (comment_id, voter_hash)
    )`,
  },
  {
    sql: "CREATE INDEX IF NOT EXISTS reader_comments_chapter_created_idx ON reader_comments (chapter_key, created_at DESC, id DESC)",
  },
  {
    sql: "CREATE INDEX IF NOT EXISTS reader_comment_likes_comment_idx ON reader_comment_likes (comment_id)",
  },
];

let schemaPromise: Promise<void> | null = null;
async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = runSql(SCHEMA_STATEMENTS).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function listOfText(value: unknown, maxItems: number): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return items.map((item) => text(item, 180)).filter(Boolean).slice(0, maxItems);
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function chapterKey(numberValue: unknown, titleValue: unknown, chapterId: unknown): string {
  const rawNumber = typeof numberValue === "number" || typeof numberValue === "string"
    ? String(numberValue).trim()
    : "";
  const number = Number(rawNumber);
  if (rawNumber && Number.isFinite(number) && number > 0) return `number:${String(number)}`;
  const normalizedChapterTitle = normalizeTitle(text(titleValue, 180));
  if (normalizedChapterTitle) return `title:${normalizedChapterTitle}`;
  const id = text(chapterId, 500);
  return id ? `id:${id}` : "";
}

function makeScope(input: Record<string, unknown>, isQuery = false): ReaderScope | null {
  const title = text(input.mangaTitle, 180);
  if (!title) return null;
  const aliases = [...new Set([title, ...listOfText(
    isQuery ? input.mangaAltTitle : input.mangaAltTitles,
    MAX_TITLE_ALIASES,
  )].map(normalizeTitle).filter(Boolean))].slice(0, MAX_TITLE_ALIASES);
  const chapterTitle = text(input.chapterTitle, 180);
  const numberValue = input.chapterNumber;
  const id = text(input.chapterId, 500);
  const key = chapterKey(numberValue, chapterTitle, id);
  if (!aliases.length || !key) return null;
  const number = typeof numberValue === "number" || typeof numberValue === "string"
    ? String(numberValue).trim()
    : "";
  const numericNumber = Number(number);
  const numberLabel = number && Number.isFinite(numericNumber)
    ? `Ch. ${String(numericNumber)}`
    : "Special chapter";
  return {
    title,
    aliases,
    chapterKey: key,
    chapterLabel: `${numberLabel}${chapterTitle ? ` — ${chapterTitle}` : ""}`.slice(0, 250),
    sourceId: text(input.sourceId, 120),
    chapterId: id,
  };
}

function decodeCell(cell: DbCell | undefined): unknown {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer" || cell.type === "float") return Number(cell.value ?? 0);
  if (cell.type === "blob") return cell.base64 ?? "";
  return cell.value ?? "";
}

function rowsAsObjects(result: DbResult | undefined): Array<Record<string, unknown>> {
  if (!result) return [];
  return result.rows.map((row) => Object.fromEntries(
    result.cols.map((column, index) => [column.name, decodeCell(row[index])]),
  ));
}

function voterHash(raw: unknown): string {
  const id = text(raw, 100);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(id)) return "";
  return createHash("sha256").update(id).digest("hex");
}

function handleError(res: import("express").Response): void {
  res.status(503).json({ error: "Comments are temporarily unavailable." });
}

router.get("/", async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: "Comments are not configured on the API server." });
  const scope = makeScope(req.query as Record<string, unknown>, true);
  if (!scope) return res.status(400).json({ error: "A manga title and chapter are required." });
  try {
    await ensureSchema();
    const placeholders = scope.aliases.map(() => "?").join(", ");
    const result = await runSql([{
      sql: `SELECT c.id, c.manga_title, c.chapter_label, c.source_id, c.username, c.body, c.created_at,
        (SELECT COUNT(*) FROM reader_comment_likes l WHERE l.comment_id = c.id) AS like_count,
        EXISTS(SELECT 1 FROM reader_comment_likes l WHERE l.comment_id = c.id AND l.voter_hash = ?) AS liked
        FROM reader_comments c
        WHERE c.chapter_key = ?
          AND EXISTS(SELECT 1 FROM json_each(c.manga_aliases) AS alias WHERE alias.value IN (${placeholders}))
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${MAX_COMMENTS}`,
      args: [voterHash(req.get("X-Reader-Voter")), scope.chapterKey, ...scope.aliases],
    }]);
    const comments = rowsAsObjects(result[0]).map((row) => ({
      id: Number(row.id),
      mangaTitle: String(row.manga_title ?? ""),
      chapterLabel: String(row.chapter_label ?? ""),
      sourceId: String(row.source_id ?? ""),
      username: String(row.username ?? "Reader"),
      body: String(row.body ?? ""),
      createdAt: String(row.created_at ?? ""),
      likeCount: Number(row.like_count ?? 0),
      liked: Number(row.liked ?? 0) === 1,
    }));
    res.setHeader("Cache-Control", "no-store");
    return res.json({ comments });
  } catch {
    return handleError(res);
  }
});

router.post("/", async (req, res) => {
  const user = req.isAuthenticated?.() && req.user
    ? req.user as { id?: string; username?: string; displayName?: string; email?: string }
    : null;
  if (!user?.id) return res.status(401).json({ error: "Sign in to post a comment." });
  if (!isConfigured()) return res.status(503).json({ error: "Comments are not configured on the API server." });
  const scope = makeScope(req.body as Record<string, unknown>);
  if (!scope) return res.status(400).json({ error: "A manga title and chapter are required." });
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `Comments must be between 1 and ${MAX_COMMENT_LENGTH} characters.` });
  }
  const username = text(user.username, 32) || text(user.displayName, 32) || text(user.email?.split("@")[0], 32) || "Reader";
  const createdAt = new Date().toISOString();
  try {
    await ensureSchema();
    const result = await runSql([{
      sql: `INSERT INTO reader_comments
        (manga_title, manga_aliases, chapter_key, chapter_label, source_id, chapter_id, user_id, username, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [scope.title, JSON.stringify(scope.aliases), scope.chapterKey, scope.chapterLabel, scope.sourceId, scope.chapterId, String(user.id), username, body, createdAt],
    }]);
    const id = Number(result[0]?.last_insert_rowid ?? 0);
    if (!id) return handleError(res);
    return res.status(201).json({
      comment: {
        id,
        mangaTitle: scope.title,
        chapterLabel: scope.chapterLabel,
        sourceId: scope.sourceId,
        username,
        body,
        createdAt,
        likeCount: 0,
        liked: false,
      },
    });
  } catch {
    return handleError(res);
  }
});

router.post("/:id/like", async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: "Comments are not configured on the API server." });
  const id = Number(req.params.id);
  const hash = voterHash(req.get("X-Reader-Voter"));
  if (!Number.isSafeInteger(id) || id < 1 || !hash) {
    return res.status(400).json({ error: "A valid comment and anonymous reader ID are required." });
  }
  if (typeof req.body?.liked !== "boolean") return res.status(400).json({ error: "liked must be a boolean." });
  try {
    await ensureSchema();
    const exists = await runSql([{
      sql: "SELECT id FROM reader_comments WHERE id = ? LIMIT 1",
      args: [id],
    }]);
    if (!exists[0]?.rows.length) return res.status(404).json({ error: "Comment not found." });
    if (req.body.liked) {
      await runSql([{
        sql: "INSERT OR IGNORE INTO reader_comment_likes (comment_id, voter_hash, created_at) VALUES (?, ?, ?)",
        args: [id, hash, new Date().toISOString()],
      }]);
    } else {
      await runSql([{
        sql: "DELETE FROM reader_comment_likes WHERE comment_id = ? AND voter_hash = ?",
        args: [id, hash],
      }]);
    }
    const counts = await runSql([{
      sql: `SELECT COUNT(*) AS like_count,
        EXISTS(SELECT 1 FROM reader_comment_likes WHERE comment_id = ? AND voter_hash = ?) AS liked
        FROM reader_comment_likes WHERE comment_id = ?`,
      args: [id, hash, id],
    }]);
    const row = rowsAsObjects(counts[0])[0] ?? {};
    return res.json({ likeCount: Number(row.like_count ?? 0), liked: Number(row.liked ?? 0) === 1 });
  } catch {
    return handleError(res);
  }
});

export default router;
