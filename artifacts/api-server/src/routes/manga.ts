import { Router, type IRouter, type Request, type Response } from "express";
import { ComixAPI, fetchImage, type PosterQuality } from "../lib/comix";
import { logger } from "../lib/logger";

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

function listOpts(req: Request) {
  return {
    page: parsePage(req.query["page"]),
    nsfw: parseBool(req.query["nsfw"], false),
    poster: parsePoster(req.query["poster"]),
  };
}

function handleErr(res: Response, err: unknown) {
  logger.error({ err }, "comix request failed");
  const msg = err instanceof Error ? err.message : "Unknown error";
  res.status(502).json({ error: msg });
}

router.get("/popular", async (req, res) => {
  try {
    const data = await ComixAPI.popular(listOpts(req));
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/latest", async (req, res) => {
  try {
    const data = await ComixAPI.latest(listOpts(req));
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/search", async (req, res) => {
  try {
    const query = String(req.query["query"] ?? "").trim();
    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const data = await ComixAPI.search(query, listOpts(req));
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/manga/:id", async (req, res) => {
  try {
    const id = String(req.params["id"]).trim();
    const data = await ComixAPI.details(id, {
      poster: parsePoster(req.query["poster"]),
      alt: parseBool(req.query["alt"], true),
      score: parseScore(req.query["score"]),
    });
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/manga/:id/chapters", async (req, res) => {
  try {
    const id = String(req.params["id"]).trim();
    const dedupe = parseBool(req.query["dedupe"], true);
    const data = await ComixAPI.chapters(id, dedupe);
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

router.get("/chapter/:id/pages", async (req, res) => {
  try {
    const id = String(req.params["id"]).trim();
    const data = await ComixAPI.pages(id);
    res.json(data);
  } catch (err) {
    handleErr(res, err);
  }
});

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "::") return true;
  // IPv4 literal
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
  // IPv6 unique-local / link-local
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  return false;
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
    const img = await fetchImage(url);
    res.status(img.status === 200 ? 200 : img.status);
    res.setHeader("Content-Type", img.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(img.data);
  } catch (err) {
    handleErr(res, err);
  }
});

export default router;
