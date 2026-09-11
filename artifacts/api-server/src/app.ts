import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import passport from "passport";
import router from "./routes";
import { buildSessionMiddleware } from "./routes/auth";
import { logger } from "./lib/logger";
import http from "http";
import path from "path";
import * as fs from "fs";
import * as nodePath from "path";
import axios from "axios";
import { getKoofrCover, koofrStream, koofrThumbnail, isProxySafe, CACHE_ROOT as KOOFR_CACHE_ROOT } from "./sources/koofr.js";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url?.startsWith("/api/image") ?? false,
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins = [
  "http://localhost:19597",
  "http://localhost:8080",
  ...(process.env["FRONTEND_URL"]
    ? [process.env["FRONTEND_URL"].replace(/\/+$/, "")]
    : []),
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin.endsWith(".vercel.app")) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

// Apply session + passport globally so ALL routes (including /api/library) can use req.isAuthenticated()
app.use(buildSessionMiddleware());
app.use(passport.initialize());
app.use(passport.session());

const iconPath = path.join(__dirname, "../../comix-web/public/public/source-icons");
app.use("/public/source-icons", express.static(iconPath));

const publicPath = path.join(__dirname, "../../comix-web/public");
app.use("/public", express.static(publicPath));

const iconPath2 = path.join(__dirname, "../../comix-web/public/public");
app.use("/public/public", express.static(iconPath2));

// Inline fallback icons — served directly from memory so they always work
// even if the static path doesn't resolve on the deployment server.
app.get("/public/koofr-video-cover.svg", (_req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" fill="none">
  <rect width="120" height="160" rx="8" fill="#0f3460"/>
  <circle cx="60" cy="70" r="28" fill="#4a90d9" opacity=".3"/>
  <path d="M52 60L72 70L52 80Z" fill="#4a90d9"/>
  <rect x="42" y="56" width="24" height="4" rx="2" fill="#4a90d9" opacity=".4"/>
  <rect x="20" y="115" width="80" height="8" rx="4" fill="#0f3460"/>
  <rect x="20" y="129" width="55" height="6" rx="3" fill="#0f3460"/>
</svg>`);
});

// 🚀 ADDED: Direct proxy interceptor to beat hotlink protections
app.get("/api/image-proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  const refererUrl = (req.query.referer as string) || "https://comickfan.com/";

  if (!targetUrl) {
    return res.status(400).send("Missing target image url parameter.");
  }

  try {
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer", 
      headers: {
        "Referer": refererUrl, 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      timeout: 15000,
    });

    res.set("Content-Type", String(response.headers["content-type"] || "image/jpeg"));
    res.set("Cache-Control", "public, max-age=86400"); 
    
    return res.send(Buffer.from(response.data));
  } catch (error: any) {
    logger.error({ err: error.message, url: targetUrl }, "Image proxy routing failure");
    return res.status(500).send("Failed to retrieve proxy asset data.");
  }
});

// ── AllManga video proxy — preserves CDN referer + byte ranges ──────────────
// AllAnime video paths are not consistently playable cross-origin. Keep the
// source URL server-side, validate the hostname, and forward range requests
// so seeking works in the shared video player.
//
// Allowed hosts include all known AllAnime CDN hosts plus the new mkissa
// mirror. The proxy sends full browser-like headers to avoid Cloudflare
// blocks on the CDN side.
const ALLOWED_VIDEO_HOSTS = [
  ".youtube-anime.com",
  ".mkissa.net",
  ".allanime.day",
  ".fast4speed.rsvp",
];

const VIDEO_PROXY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function isAllowedVideoHost(hostname: string): boolean {
  return ALLOWED_VIDEO_HOSTS.some(suffix => hostname.endsWith(suffix));
}

app.get("/api/allmanga/video", async (req, res) => {
  const targetUrl = String(req.query.url ?? "");
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "Invalid video URL" });
  }
  if (target.protocol !== "https:" || !isAllowedVideoHost(target.hostname)) {
    return res.status(403).json({ error: "Video host is not allowed" });
  }
  try {
    const range = req.headers.range;
    const upstream = await axios.get(target.toString(), {
      responseType: "stream",
      headers: {
        Referer: "https://mkissa.to/",
        Origin: "https://mkissa.to",
        "User-Agent": VIDEO_PROXY_UA,
        Accept: "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "video",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
        ...(range ? { Range: range } : {}),
      },
      timeout: 120_000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    // If we got a Cloudflare challenge page (HTML instead of video),
    // return a clear error so the player can surface it.
    const ct = upstream.headers["content-type"] as string | undefined;
    if (ct && ct.includes("text/html")) {
      logger.error({ url: target.hostname, status: upstream.status, contentType: ct }, "AllManga video proxy got Cloudflare challenge");
      if (!res.headersSent) res.status(502).json({ error: "Video CDN is behind Cloudflare. Bypass server may be needed." });
      return;
    }

    res.status(upstream.status);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");
    for (const header of ["content-type", "content-length", "content-range"]) {
      if (upstream.headers[header]) res.setHeader(header, upstream.headers[header] as string);
    }
    (upstream.data as NodeJS.ReadableStream).pipe(res);
    (upstream.data as NodeJS.ReadableStream).on("error", () => {
      if (!res.headersSent) res.status(502).end();
    });
    return;
  } catch (err: any) {
    logger.error({ err: err.message, url: target.hostname }, "AllManga video proxy failed");
    if (!res.headersSent) return res.status(502).json({ error: "Failed to stream AllManga video" });
    return;
  }
});

// ── Koofr: serve extracted zip page from local cache ─────────────────────────
app.get("/api/koofr/file", (req, res) => {
  const dir  = req.query.dir  as string;
  const file = req.query.file as string;
  if (!dir || !file) return res.status(400).json({ error: "dir and file required" });
  if (!/^[a-f0-9]{32}$/.test(dir)) return res.status(400).json({ error: "bad dir" });
  const filePath = nodePath.join(KOOFR_CACHE_ROOT, dir, nodePath.basename(file));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  res.setHeader("Cache-Control", "public, max-age=86400");
   return res.sendFile(filePath);
});

// ── Koofr: cover for zip (extracts first image only, then aborts download) ───
app.get("/api/koofr/cover", async (req, res) => {
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    const coverPath = await getKoofrCover(id);
    if (!coverPath) return res.status(404).json({ error: "no images in zip" });
    res.setHeader("Cache-Control", "public, max-age=86400");
     return res.sendFile(coverPath);
  } catch (err: any) {
    logger.error({ err: err.message }, "Koofr cover extraction failed");
     return res.status(502).json({ error: "failed to extract cover" });
  }
});

// ── Koofr: direct proxy — streams images/videos/gifs from Koofr, zero local storage ──
app.get("/api/koofr/proxy", async (req, res) => {
  const koofrPath = req.query.path as string;
  if (!koofrPath) return res.status(400).json({ error: "path required" });
  // Only allow /folder/filename paths with supported media extensions — blocks traversal and private files
  if (!isProxySafe(koofrPath)) return res.status(403).json({ error: "forbidden" });
  try {
    const rangeHeader = req.headers["range"];
    const extraHeaders: Record<string, string> = {};
    if (rangeHeader) extraHeaders["Range"] = rangeHeader;

    const koofrAuth = `Basic ${Buffer.from(`${process.env.KOOFR_EMAIL}:${process.env.KOOFR_APP_PASSWORD}`).toString("base64")}`;
    const upstream = await axios.get(`https://app.koofr.net/api/v2/mounts/primary/files/get`, {
      params: { path: koofrPath },
      headers: {
        Authorization: koofrAuth,
        ...extraHeaders,
      },
      responseType: "stream",
      timeout: 120_000,
      validateStatus: () => true,
    });

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (upstream.headers["content-type"]) res.setHeader("Content-Type", upstream.headers["content-type"] as string);
    if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"] as string);
    if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"] as string);

    res.status(upstream.status);
    (upstream.data as NodeJS.ReadableStream).pipe(res);
    (upstream.data as NodeJS.ReadableStream).on("error", () => { if (!res.headersSent) res.status(502).end(); });
    return;
  } catch (err: any) {
    logger.error({ err: err.message, path: koofrPath }, "Koofr proxy failed");
    if (!res.headersSent) return res.status(502).json({ error: "failed to stream file" });
    return;
  }
});

// ── Koofr: thumbnail — tries Koofr's thumbnail API, falls back to full proxy ──
app.get("/api/koofr/thumbnail", async (req, res) => {
  const koofrPath = req.query.path as string;
  if (!koofrPath) return res.status(400).json({ error: "path required" });
  if (!isProxySafe(koofrPath)) return res.status(403).json({ error: "forbidden" });
  try {
    const { stream, contentType } = await koofrThumbnail(koofrPath);
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (contentType) res.setHeader("Content-Type", contentType);
    (stream as any).pipe(res);
    (stream as any).on("error", async () => {
      if (!res.headersSent) {
        // Fall back to full proxy if thumbnail stream fails
        try {
          const { stream: s2, contentType: ct2 } = await koofrStream(koofrPath);
          if (ct2) res.setHeader("Content-Type", ct2);
          (s2 as any).pipe(res);
        } catch { res.status(502).end(); }
      }
    });
     return;
  } catch {
    // Koofr thumbnail API unsupported (returns 404 for most file types) — fall back to full proxy
    try {
      const { stream, contentType } = await koofrStream(koofrPath);
      res.setHeader("Cache-Control", "public, max-age=3600");
      if (contentType) res.setHeader("Content-Type", contentType);
      (stream as any).pipe(res);
      (stream as any).on("error", () => { if (!res.headersSent) res.status(502).end(); });
       return;
    } catch (err: any) {
      logger.error({ err: err.message, path: koofrPath }, "Koofr thumbnail+proxy failed");
       if (!res.headersSent) return res.status(502).json({ error: "failed to fetch file" });
       return;
    }
  }
});

app.use("/api", router);

if (process.env.NODE_ENV === "development") {
  // Development mode conditions remain here
}

export default app;
