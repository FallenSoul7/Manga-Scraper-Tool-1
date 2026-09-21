import { Router } from "express";
import axios from "axios";
import { getSourceOrNull } from "../sources/registry";
import { isSafeUrl } from "../lib/safe-fetch-url.js";

const router = Router();

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

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

  const { safe, reason } = await isSafeUrl(targetUrl);
  if (!safe) {
    res.status(400).json({ error: `Blocked: ${reason}` });
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
    const range = req.headers.range;
    const upstream = await axios.get(targetUrl, {
      responseType: "stream",
      timeout: 20000,
      maxRedirects: 0,
      maxContentLength: MAX_MEDIA_BYTES,
      maxBodyLength: MAX_MEDIA_BYTES,
      headers: {
        "User-Agent": DEFAULT_UA,
        Referer: referer,
        ...(range ? { Range: range } : {}),
        Accept: "video/*,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      validateStatus: (s) => s < 500,
    });

    if (upstream.status >= 400) {
      res.status(upstream.status).end();
      return;
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers["location"] as string | undefined;
      if (!location) {
        res.status(502).json({ error: "Redirect with no location" });
        return;
      }
      const { safe: redirSafe, reason: redirReason } = await isSafeUrl(location);
      if (!redirSafe) {
        res.status(400).json({ error: `Redirect blocked: ${redirReason}` });
        return;
      }
      res.redirect(307, `/api/image?url=${encodeURIComponent(location)}${sourceId ? `&source=${sourceId}` : ""}`);
      return;
    }

    const contentType =
      (upstream.headers["content-type"] as string | undefined) ?? "image/jpeg";
    const contentLength = Number(upstream.headers["content-length"] || 0);
    if (contentLength > MAX_MEDIA_BYTES) {
      upstream.data?.destroy?.();
      res.status(413).json({ error: "Response is too large" });
      return;
    }

    // This route is also used by the offline downloader for Pawchive and
    // other media sources. Keep the existing image behavior but allow media
    // streams and archives through the same SSRF-safe proxy.
    if (
      !contentType.startsWith("image/") &&
      !contentType.startsWith("video/") &&
      !contentType.startsWith("audio/") &&
      !contentType.startsWith("application/octet-stream") &&
      !contentType.startsWith("application/zip")
    ) {
      upstream.data?.destroy?.();
      res.status(400).json({ error: "Response is not an image" });
      return;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");

    const declaredLength = upstream.headers["content-length"];
    if (declaredLength) res.setHeader("Content-Length", String(declaredLength));
    const contentRange = upstream.headers["content-range"];
    if (contentRange) res.setHeader("Content-Range", String(contentRange));

    res.status(upstream.status === 206 ? 206 : 200);
    (upstream.data as NodeJS.ReadableStream).pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: "Failed to fetch image" });
    }
  }
});

export default router;
