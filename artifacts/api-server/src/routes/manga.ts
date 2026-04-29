import { Router, type IRouter, type Request, type Response } from "express";
import axios from "axios";
import { logger } from "../lib/logger";
import { getSource, DEFAULT_SOURCE_ID } from "../sources/registry";
import type { PosterQuality } from "../sources/types";

const router: IRouter = Router();

function parseBool(v: unknown, def: boolean): boolean {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).toLowerCase();
  if (s === "1" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "no") return false;
  return def;
}

function parsePoster(v: unknown): PosterQuality {
  const s = String(v ?? "large").toLowerCase();
  if (s === "small" || s === "medium" || s === "large") return s;
  return "large";
}

function parsePage(v: unknown): number {
  const n = Number(v ?? 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function parseScore(v: unknown): "top" | "bottom" | "none" {
  const s = String(v ?? "top").toLowerCase();
  if (s === "bottom" || s === "none" || s === "top") return s;
  return "top";
}

function readSourceId(req: Request): string {
  const headerVal = req.header("x-source");
  const queryVal =
    typeof req.query["source"] === "string" ? req.query["source"] : null;
  return (headerVal || queryVal || DEFAULT_SOURCE_ID).trim();
}

function parseTagIds(req: Request): string[] | undefined {
  // Accept either repeated `tagIds[]` or a single comma-separated `tagIds`.
  const raw = req.query["tagIds[]"] ?? req.query["tagIds"];
  if (raw === undefined) return undefined;
  const arr: string[] = Array.isArray(raw)
    ? (raw as unknown[]).map((v) => String(v))
    : String(raw).split(",");
  const out = arr.map((s) => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function listOpts(req: Request) {
  return {
    page: parsePage(req.query["page"]),
    nsfw: parseBool(req.query["nsfw"], false),
    poster: parsePoster(req.query["poster"]),
    tagIds: parseTagIds(req),
  };
}

function handleErr(res: Response, err: unknown) {
  logger.error({ err }, "source request failed");
  const msg = err instanceof Error ? err.message : "Unknown error";
  res.status(502).json({ error: msg });
}

router.get("/popular", async (req, res) => {
  try {
    const source = getSource(readSourceId(req));
    res.json(await source.popular(listOpts(req)));
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/latest", async (req, res) => {
  try {
    const source = getSource(readSourceId(req));
    res.json(await source.latest(listOpts(req)));
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/search", async (req, res) => {
  try {
    const query = String(req.query["query"] ?? "").trim();
    const opts = listOpts(req);
    const hasTags = !!(opts.tagIds && opts.tagIds.length > 0);
    if (!query && !hasTags) {
      res.status(400).json({ error: "query or tagIds is required" });
      return;
    }
    const source = getSource(readSourceId(req));
    // When the user is filtering by tag only (no text), fall back to the
    // popular listing — the filter is applied via tagIds and we don't have
    // a meaningful keyword to feed to the search endpoint.
    if (!query) {
      res.json(await source.popular(opts));
      return;
    }
    res.json(await source.search(query, opts));
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/tags", async (req, res) => {
  try {
    const source = getSource(readSourceId(req));
    if (!source.tags) {
      res.json([]);
      return;
    }
    res.json(await source.tags());
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/manga/:id", async (req, res) => {
  try {
    const id = String(req.params["id"]).trim();
    const source = getSource(readSourceId(req));
    res.json(
      await source.details(id, {
        poster: parsePoster(req.query["poster"]),
        alt: parseBool(req.query["alt"], true),
        score: parseScore(req.query["score"]),
      }),
    );
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/manga/:id/chapters", async (req, res) => {
  try {
    const id = String(req.params["id"]).trim();
    const dedupe = parseBool(req.query["dedupe"], true);
    const source = getSource(readSourceId(req));
    res.json(await source.chapters(id, dedupe));
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/chapter/:id/pages", async (req, res) => {
  try {
    const id = String(req.params["id"]).trim();
    const source = getSource(readSourceId(req));
    res.json(await source.pages(id));
  } catch (err) {
    handleErr(res, err);
  }
});

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "::") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10)];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  return false;
}

async function fetchImage(url: string, referer: string | undefined) {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (referer) headers["Referer"] = referer;
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers,
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return {
    status: res.status,
    contentType:
      (res.headers["content-type"] as string | undefined) ?? "image/jpeg",
    data: Buffer.from(res.data),
  };
}

router.get("/image", async (req, res) => {
  try {
    const url = String(req.query["url"] ?? "");
    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).send("invalid url");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).send("invalid url");
      return;
    }
    if (isPrivateHost(parsed.hostname)) {
      res.status(400).send("host not allowed");
      return;
    }
    let referer: string | undefined;
    try {
      const source = getSource(readSourceId(req));
      referer = source.imageReferer;
    } catch {
      /* ignore */
    }
    const img = await fetchImage(url, referer);
    res.status(img.status === 200 ? 200 : img.status);
    res.setHeader("Content-Type", img.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(img.data);
  } catch (err) {
    handleErr(res, err);
  }
});

export default router;
