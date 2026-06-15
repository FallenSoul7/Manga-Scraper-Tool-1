import { Router } from "express";
import axios from "axios";
import { getSourceOrNull } from "../sources/registry";

const router = Router();

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

router.get("/", async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  const sourceId = req.query.source as string | undefined;

  if (!rawUrl) {
    res.status(400).json({ error: "Missing url param" });
    return;
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid url param" });
    return;
  }

  const source = sourceId ? getSourceOrNull(sourceId) : null;

  let referer: string;
  if (source?.imageReferer) {
    referer = source.imageReferer;
  } else {
    try {
      const u = new URL(targetUrl);
      referer = `${u.protocol}//${u.host}/`;
    } catch {
      referer = targetUrl;
    }
  }

  try {
    const upstream = await axios.get(targetUrl, {
      responseType: "stream",
      timeout: 20000,
      headers: {
        "User-Agent": DEFAULT_UA,
        Referer: referer,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      validateStatus: (s) => s < 500,
    });

    if (upstream.status >= 400) {
      res.status(upstream.status).end();
      return;
    }

    const contentType =
      (upstream.headers["content-type"] as string | undefined) ?? "image/jpeg";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const contentLength = upstream.headers["content-length"];
    if (contentLength) res.setHeader("Content-Length", contentLength);

    (upstream.data as NodeJS.ReadableStream).pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: "Failed to fetch image" });
    }
  }
});

export default router;
