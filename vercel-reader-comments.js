const { createHash } = require("node:crypto");

const MAX_COMMENT_LENGTH = 2000;
const MAX_TITLE_ALIASES = 12;
const MAX_COMMENTS = 100;
const AUTH_BACKENDS = [
  process.env.COMIHUB_PRIMARY_BACKEND || "https://manga-scraper-tool-2.onrender.com",
  process.env.COMIHUB_FALLBACK_BACKEND || "https://comihub-backend.onrender.com",
];
const TURSO_TIMEOUT_MS = Number(process.env.COMIHUB_TURSO_TIMEOUT_MS) || 8_000;
const AUTH_TIMEOUT_MS = Number(process.env.COMIHUB_AUTH_TIMEOUT_MS) || 8_000;

const SCHEMA_STATEMENTS = [
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

let schemaReady = false;

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function listOfText(value, maxItems) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return items.map((item) => text(item, 180)).filter(Boolean).slice(0, maxItems);
}

function normalizeTitle(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function makeChapterKey(numberValue, titleValue, chapterId) {
  const rawNumber = typeof numberValue === "number" || typeof numberValue === "string"
    ? String(numberValue).trim()
    : "";
  const number = Number(rawNumber);
  if (rawNumber && Number.isFinite(number) && number > 0) return `number:${String(number)}`;
  const normalizedTitle = normalizeTitle(text(titleValue, 180));
  if (normalizedTitle) return `title:${normalizedTitle}`;
  const id = text(chapterId, 500);
  return id ? `id:${id}` : "";
}

function makeScope(input, isQuery = false) {
  const title = text(input.mangaTitle, 180);
  if (!title) return null;
  const aliases = [...new Set([
    title,
    ...listOfText(isQuery ? input.mangaAltTitle : input.mangaAltTitles, MAX_TITLE_ALIASES),
  ].map(normalizeTitle).filter(Boolean))].slice(0, MAX_TITLE_ALIASES);
  const chapterTitle = text(input.chapterTitle, 180);
  const numberValue = input.chapterNumber;
  const id = text(input.chapterId, 500);
  const key = makeChapterKey(numberValue, chapterTitle, id);
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

function tursoEndpoint() {
  let base = (process.env.TURSO_DATABASE_URL || "").trim();
  if (!base) throw new Error("Turso comments database is not configured.");
  if (base.startsWith("libsql://")) base = `https://${base.slice("libsql://".length)}`;
  if (base.startsWith("turso://")) base = `https://${base.slice("turso://".length)}`;
  const url = new URL(base);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/v2/pipeline") ? pathname : `${pathname}/v2/pipeline`;
  url.search = "";
  return url.toString();
}

function encodeArgument(value) {
  return typeof value === "number"
    ? { type: Number.isInteger(value) ? "integer" : "float", value: String(value) }
    : { type: "text", value: String(value) };
}

async function fetchJsonWithTimeout(url, init, parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function runSql(statements, parentSignal) {
  const token = (process.env.TURSO_AUTH_TOKEN || "").trim();
  if (!token) throw new Error("Turso comments database is not configured.");
  const requests = statements.map(({ sql, args }) => ({
    type: "execute",
    stmt: {
      sql,
      ...(args?.length ? { args: args.map(encodeArgument) } : {}),
    },
  }));
  requests.push({ type: "close" });
  const { response, payload } = await fetchJsonWithTimeout(tursoEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  }, parentSignal, TURSO_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Turso request failed (${response.status}).`);
  const results = payload?.results || [];
  const failed = results.find((entry) => entry.type !== "ok");
  if (failed) throw new Error(failed.error?.message || "Turso query failed.");
  if (!schemaReady) schemaReady = true;
  return results.flatMap((entry) => entry.response?.result ? [entry.response.result] : []);
}

function statementsWithSchema(statements) {
  return schemaReady ? statements : [...SCHEMA_STATEMENTS, ...statements];
}

function decodeCell(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer" || cell.type === "float") return Number(cell.value ?? 0);
  if (cell.type === "blob") return cell.base64 ?? "";
  return cell.value ?? "";
}

function rowsAsObjects(result) {
  if (!result) return [];
  return result.rows.map((row) => Object.fromEntries(
    result.cols.map((column, index) => [column.name, decodeCell(row[index])]),
  ));
}

function voterHash(raw) {
  const id = text(raw, 100);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(id)) return "";
  return createHash("sha256").update(id).digest("hex");
}

function getRequestUrl(req) {
  return new URL(req.url || "/", "http://vercel.internal");
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

async function authenticatedUser(req, parentSignal) {
  const cookie = req.headers?.cookie;
  if (!cookie) return null;
  const headers = { Accept: "application/json" };
  if (Array.isArray(cookie)) headers.Cookie = cookie.join("; ");
  else headers.Cookie = cookie;
  let lastError;
  for (const backend of AUTH_BACKENDS) {
    try {
      const { response, payload } = await fetchJsonWithTimeout(
        `${backend.replace(/\/+$/, "")}/api/auth/me`,
        { method: "GET", headers },
        parentSignal,
        AUTH_TIMEOUT_MS,
      );
      if (response.status === 401) return null;
      if (!response.ok) {
        if (response.status === 408 || response.status >= 500) {
          lastError = new Error(`ComiHub login verification failed (${response.status}).`);
          continue;
        }
        throw new Error("ComiHub login verification is unavailable.");
      }
      const user = payload?.user;
      if (!user || typeof user.id !== "string" || !user.id) return null;
      const email = text(user.email, 254);
      return {
        id: user.id,
        username: text(user.username, 32) || text(user.displayName, 32) || text(email.split("@")[0], 32) || "Reader",
      };
    } catch (error) {
      if (parentSignal?.aborted) throw error;
      lastError = error;
    }
  }
  if (lastError) throw new Error("ComiHub login verification is unavailable.");
  return null;
}

async function getComments(req, res, parentSignal, url) {
  const params = url.searchParams;
  const scope = makeScope({
    mangaTitle: params.get("mangaTitle"),
    mangaAltTitle: params.getAll("mangaAltTitle"),
    chapterNumber: params.get("chapterNumber"),
    chapterTitle: params.get("chapterTitle"),
    chapterId: params.get("chapterId"),
    sourceId: params.get("sourceId"),
  }, true);
  if (!scope) return res.status(400).json({ error: "A manga title and chapter are required." });
  const placeholders = scope.aliases.map(() => "?").join(", ");
  const voter = req.headers?.["x-reader-voter"];
  const result = await runSql(statementsWithSchema([{
    sql: `SELECT c.id, c.manga_title, c.chapter_label, c.source_id, c.username, c.body, c.created_at,
      (SELECT COUNT(*) FROM reader_comment_likes l WHERE l.comment_id = c.id) AS like_count,
      EXISTS(SELECT 1 FROM reader_comment_likes l WHERE l.comment_id = c.id AND l.voter_hash = ?) AS liked
      FROM reader_comments c
      WHERE c.chapter_key = ?
        AND EXISTS(SELECT 1 FROM json_each(c.manga_aliases) AS alias WHERE alias.value IN (${placeholders}))
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${MAX_COMMENTS}`,
    args: [voterHash(voter), scope.chapterKey, ...scope.aliases],
  }]), parentSignal);
  const queryResult = result[result.length - 1];
  const comments = rowsAsObjects(queryResult).map((row) => ({
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
  return res.status(200).json({ comments });
}

async function postComment(req, res, parentSignal) {
  let user;
  try {
    user = await authenticatedUser(req, parentSignal);
  } catch {
    return res.status(503).json({ error: "Sign-in verification is temporarily unavailable." });
  }
  if (!user) return res.status(401).json({ error: "Sign in to post a comment." });

  const bodyData = requestBody(req);
  const scope = makeScope(bodyData);
  if (!scope) return res.status(400).json({ error: "A manga title and chapter are required." });
  const body = typeof bodyData.body === "string" ? bodyData.body.trim() : "";
  if (!body || body.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `Comments must be between 1 and ${MAX_COMMENT_LENGTH} characters.` });
  }
  const createdAt = new Date().toISOString();
  const result = await runSql(statementsWithSchema([{
    sql: `INSERT INTO reader_comments
      (manga_title, manga_aliases, chapter_key, chapter_label, source_id, chapter_id, user_id, username, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [scope.title, JSON.stringify(scope.aliases), scope.chapterKey, scope.chapterLabel,
      scope.sourceId, scope.chapterId, user.id, user.username, body, createdAt],
  }]), parentSignal);
  const inserted = result[result.length - 1];
  const id = Number(inserted?.last_insert_rowid ?? 0);
  if (!id) return res.status(503).json({ error: "Comments are temporarily unavailable." });
  res.setHeader("Cache-Control", "no-store");
  return res.status(201).json({
    comment: {
      id,
      mangaTitle: scope.title,
      chapterLabel: scope.chapterLabel,
      sourceId: scope.sourceId,
      username: user.username,
      body,
      createdAt,
      likeCount: 0,
      liked: false,
    },
  });
}

async function toggleLike(req, res, parentSignal, path) {
  const match = path.match(/^\/api\/reader-comments\/(\d+)\/like$/);
  const id = Number(match?.[1]);
  const hash = voterHash(req.headers?.["x-reader-voter"]);
  const body = requestBody(req);
  if (!Number.isSafeInteger(id) || id < 1 || !hash) {
    return res.status(400).json({ error: "A valid comment and anonymous reader ID are required." });
  }
  if (typeof body.liked !== "boolean") return res.status(400).json({ error: "liked must be a boolean." });
  const createdAt = new Date().toISOString();
  const writeStatement = body.liked
    ? {
        sql: `INSERT OR IGNORE INTO reader_comment_likes (comment_id, voter_hash, created_at)
          SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM reader_comments WHERE id = ?)`,
        args: [id, hash, createdAt, id],
      }
    : {
        sql: `DELETE FROM reader_comment_likes
          WHERE comment_id = ? AND voter_hash = ? AND EXISTS (SELECT 1 FROM reader_comments WHERE id = ?)`,
        args: [id, hash, id],
      };
  const schemaOffset = schemaReady ? 0 : SCHEMA_STATEMENTS.length;
  const results = await runSql(statementsWithSchema([
    { sql: "SELECT id FROM reader_comments WHERE id = ? LIMIT 1", args: [id] },
    writeStatement,
    {
      sql: `SELECT COUNT(*) AS like_count,
        EXISTS(SELECT 1 FROM reader_comment_likes WHERE comment_id = ? AND voter_hash = ?) AS liked
        FROM reader_comment_likes WHERE comment_id = ?`,
      args: [id, hash, id],
    },
  ]), parentSignal);
  const exists = results[schemaOffset];
  if (!exists?.rows?.length) return res.status(404).json({ error: "Comment not found." });
  const row = rowsAsObjects(results[schemaOffset + 2])[0] ?? {};
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ likeCount: Number(row.like_count ?? 0), liked: Number(row.liked ?? 0) === 1 });
}

async function handleReaderComments(req, res, parentSignal) {
  const url = getRequestUrl(req);
  const path = url.pathname;
  if (path !== "/api/reader-comments" && !path.startsWith("/api/reader-comments/")) return false;
  if (!(process.env.TURSO_DATABASE_URL || "").trim() || !(process.env.TURSO_AUTH_TOKEN || "").trim()) {
    res.status(503).json({ error: "Comments are not configured on the API server." });
    return true;
  }
  try {
    if (path === "/api/reader-comments" && req.method === "GET") {
      await getComments(req, res, parentSignal, url);
      return true;
    }
    if (path === "/api/reader-comments" && req.method === "POST") {
      await postComment(req, res, parentSignal);
      return true;
    }
    if (/^\/api\/reader-comments\/\d+\/like$/.test(path) && req.method === "POST") {
      await toggleLike(req, res, parentSignal, path);
      return true;
    }
    res.status(404).json({ error: "Comments endpoint not found." });
    return true;
  } catch {
    if (!res.headersSent && !res.destroyed) {
      res.status(503).json({ error: "Comments are temporarily unavailable." });
    }
    return true;
  }
}

module.exports = handleReaderComments;
