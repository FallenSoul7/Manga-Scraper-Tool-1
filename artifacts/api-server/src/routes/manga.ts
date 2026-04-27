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

router.get("/image", async (req, res) => {
  try {
    const url = String(req.query["url"] ?? "");
    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).send("invalid url");
      return;
    }
    const host = new URL(url).host.replace(/^www\./, "");
    if (
      !host.endsWith("comix.to") &&
      !host.endsWith("comix.cdn") &&
      !host.endsWith("cdn.comix.to") &&
      !host.endsWith("cloudfront.net") &&
      !host.endsWith("amazonaws.com") &&
      !host.endsWith("imgur.com") &&
      !host.endsWith("wp.com") &&
      !host.endsWith("comix-cdn.com") &&
      !host.endsWith("akamaized.net") &&
      !host.endsWith("comix-images.com")
    ) {
      // allow only known image hosts; comix.to images may come from a CDN
      // err on the side of allowing common CDNs above; reject the rest.
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
