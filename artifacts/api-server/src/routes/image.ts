import { Router } from "express";
import axios from "axios";
import { getSourceOrNull } from "../sources/registry";
import { lookup } from "dns/promises";
import { isIP } from "net";

const router = Router();

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function isPrivateOrLoopback(ip: string): boolean {
  const v4 = isIP(ip) === 4;
  const v6 = isIP(ip) === 6;

  if (v4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (v6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
    if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;
    if (lower.startsWith("::ffff:")) {
      const embedded = lower.slice(7);
      return isPrivateOrLoopback(embedded);
    }
    return false;
  }

  return true;
}

async function isSafeUrl(raw: string): Promise<{ safe: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { safe: false, reason: "invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: "scheme not allowed" };
  }

  const hostname = url.hostname;

  if (isIP(hostname)) {
    if (isPrivateOrLoopback(hostname)) {
      return { safe: false, reason: "private IP not allowed" };
    }
    return { safe: true };
  }

  const blockedHosts = ["localhost", "metadata.google.internal", "169.254.169.254"];
  if (blockedHosts.includes(hostname.toLowerCase())) {
    return { safe: false, reason: "blocked hostname" };
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateOrLoopback(address)) {
        return { safe: false, reason: "resolves to private IP" };
      }
    }
  } catch {
    return { safe: false, reason: "DNS resolution failed" };
  }

  return { safe: true };
}

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
    const upstream = await axios.get(targetUrl, {
      responseType: "stream",
      timeout: 20000,
      maxRedirects: 0,
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

    if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
      upstream.data?.destroy?.();
      res.status(400).json({ error: "Response is not an image" });
      return;
    }

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
