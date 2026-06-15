import { Router } from "express";
import type { Request, Response } from "express";
import { getSource, getSourceOrNull } from "../sources/registry";
import type { ListOptions, PosterQuality } from "../sources/types";

const router = Router();

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(500).json({ error: msg });
    }
  };
}

// ── Tags ───────────────────────────────────────────────────────────────────

router.get("/tags", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  if (!src.tags) return [];
  return src.tags();
}));

// ── Popular ────────────────────────────────────────────────────────────────

router.get("/popular", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  return src.popular(listOpts(req));
}));

// ── Latest ─────────────────────────────────────────────────────────────────

router.get("/latest", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  return src.latest(listOpts(req));
}));

// ── Search ─────────────────────────────────────────────────────────────────

router.get("/search", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  const q = req.query as Record<string, string>;
  return src.search(q.query ?? "", listOpts(req));
}));

// ── Manga detail ───────────────────────────────────────────────────────────

router.get("/manga/:id", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  const q = req.query as Record<string, string>;
  return src.details(req.params.id, {
    poster: (["small", "medium", "large"].includes(q.poster)
      ? q.poster
      : "medium") as PosterQuality,
    alt: q.alt === "true",
    score: (["top", "bottom", "none"].includes(q.score)
      ? q.score
      : "none") as "top" | "bottom" | "none",
  });
}));

// ── Chapter list ───────────────────────────────────────────────────────────

router.get("/manga/:id/chapters", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  const dedupe = req.query.dedupe !== "false";
  return src.chapters(req.params.id, dedupe);
}));

// ── Chapter pages ──────────────────────────────────────────────────────────

router.get("/chapter/:id/pages", wrap(async (req) => {
  const src = getSource(getSourceId(req));
  return src.pages(req.params.id);
}));

// ── Popular sorts ──────────────────────────────────────────────────────────

router.get("/popular-sorts", wrap(async (req) => {
  const src = getSourceOrNull(getSourceId(req));
  return src?.popularSorts ?? [];
}));

export default router;
