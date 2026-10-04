import { Router } from "express";
import type { Request, Response } from "express";
import { getSource, getSourceOrNull } from "../sources/registry";
import type { ListOptions, PosterQuality } from "../sources/types";
import { logger } from "../lib/logger";

const router = Router();

// Public source listings are expensive upstream scrapes. Keep a small,
// process-local cache to avoid repeating identical requests when several
// clients open the same source at once. Keys include the source header and
// complete query string, so one source can never receive another source's data.
type CacheEntry = { expiresAt: number; value: unknown };
const listCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 256;

function cacheKey(req: Request): string {
  return `${String(req.headers["x-source"] ?? "")} ${req.originalUrl}`;
}

async function cached<T>(req: Request, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const key = cacheKey(req);
  const now = Date.now();
  const hit = listCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const request = loader().then((value) => {
    if (listCache.size >= MAX_CACHE_ENTRIES && !listCache.has(key)) {
      const oldest = listCache.keys().next().value;
      if (oldest) listCache.delete(oldest);
    }
    listCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getSourceId(req: Request): string {
  return (req.headers["x-source"] as string | undefined) ?? "";
}

function listOpts(req: Request): ListOptions {
  const q = req.query as Record<string, string | string[]>;
  return {
    page: Math.max(1, parseInt(String(q.page ?? "1"), 10)),
    nsfw: String(q.nsfw ?? "true") !== "false",
    poster: (["small", "medium", "large"].includes(String(q.poster))
      ? q.poster
      : "medium") as PosterQuality,
    media: (["all", "manga", "anime", "novel"].includes(String(q.media))
      ? String(q.media)
      : "all") as ListOptions["media"],
    sort: q.sort ? String(q.sort) : undefined,
    tagIds: Array.isArray(q["tagIds[]"])
      ? (q["tagIds[]"] as string[])
      : q["tagIds[]"]
        ? [String(q["tagIds[]"])]
        : undefined,
  };
}

function wrap(
  handler: (req: Request, res: Response) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result);
    } catch {
      logger.error("Manga source request failed");
      if (!res.headersSent) res.status(500).json({ error: "Source request failed" });
    }
  };
}

// ── Tags ───────────────────────────────────────────────────────────────────

router.get("/tags", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  if (!src.tags) return [];
  return cached(req, 60 * 60 * 1000, () => src.tags!());
}));

// ── Popular ────────────────────────────────────────────────────────────────

router.get("/popular", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  return cached(req, 45 * 1000, () => src.popular(listOpts(req)));
}));

// ── Latest ─────────────────────────────────────────────────────────────────

router.get("/latest", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  return cached(req, 45 * 1000, () => src.latest(listOpts(req)));
}));

// ── Search ─────────────────────────────────────────────────────────────────

router.get("/search", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  const q = req.query as Record<string, string>;
  return cached(req, 30 * 1000, () => src.search(q.query ?? "", listOpts(req)));
}));

// ── Manga detail ───────────────────────────────────────────────────────────

router.get("/manga/:id", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  const q = req.query as Record<string, string>;
  return cached(req, 5 * 60 * 1000, () => src.details(String(req.params.id), {
      poster: (["small", "medium", "large"].includes(q.poster)
        ? q.poster
        : "medium") as PosterQuality,
      alt: q.alt === "true",
      score: (["top", "bottom", "none"].includes(q.score)
        ? q.score
        : "none") as "top" | "bottom" | "none",
    }));
}));

// ── Chapter list ───────────────────────────────────────────────────────────

router.get("/manga/:id/chapters", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  const dedupe = req.query.dedupe !== "false";
  return cached(req, 5 * 60 * 1000, () => src.chapters(String(req.params.id), dedupe));
}));

// ── Chapter pages ──────────────────────────────────────────────────────────

router.get("/chapter/:id/pages", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  return src.pages(String(req.params.id));
}));

// ── Popular sorts ──────────────────────────────────────────────────────────

router.get("/popular-sorts", wrap(async (req) => {
  const src = getSourceOrNull(getSourceId(req));
  return src?.popularSorts ?? [];
}));

export default router;
