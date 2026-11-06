import express, { type Express, type Request } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import passport from "passport";
import router from "./routes";
import { buildSessionMiddleware } from "./routes/auth";
import { logger } from "./lib/logger";
import http from "http";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";
import { configureMangaThemesiaParser } from "@fallensoul7/frwilxe-hub-sources";
import { parseHtmlWithRust } from "./utils/rust-parser";

const app: Express = express();
configureMangaThemesiaParser(parseHtmlWithRust);
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env["NODE_ENV"] === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(
  pinoHttp({
    logger,
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
  // Production frontend domains. Keep these explicit because the API uses
  // credentials and must not allow arbitrary origins.
  "https://www.comihub.top",
  "https://comihub.top",
  "https://comihub.vercel.app",
  // Capacitor Android and iOS WebViews use these stable local origins when
  // calling the explicitly configured production API from the native shell.
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  ...(process.env["FRONTEND_URL"]
    ? [process.env["FRONTEND_URL"].replace(/\/+$/, "")]
    : []),
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  return next();
});

app.use(express.json({
  limit: "4mb",
  verify: (req, _res, buffer) => {
    // Paddle signs the exact raw JSON payload. Keep it only for webhook verification.
    if ((req.url ?? "").includes("/paddle/webhook")) (req as any).rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

// Public source reads must remain available even when the session database is
// slow or unavailable. The session store is Postgres-backed; putting it in
// front of every catalog/list/detail request made unrelated DB stalls look
// like every extension was broken. Keep sessions for auth and other private
// routes, but bypass them for read-only public content endpoints.
function isPublicReadRequest(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const path = req.path;
  if (
    path === "/api/healthz" ||
    path === "/api/sources/registry" ||
    path === "/api/sources/registry/version" ||
    path === "/api/popular" ||
    path === "/api/latest" ||
    path === "/api/search" ||
    path === "/api/tags" ||
    path === "/api/popular-sorts" ||
    path === "/api/source-media" ||
    path === "/api/reader-comments" ||
    path === "/api/direct-fetch"
  ) return true;

  return /^\/api\/manga\/[^/]+(?:\/chapters)?$/.test(path) ||
    /^\/api\/chapter\/[^/]+\/pages$/.test(path);
}

const sessionMiddleware = buildSessionMiddleware();
const passportSessionMiddleware = passport.session();

app.use((req, res, next) => {
  if (isPublicReadRequest(req)) return next();
  return sessionMiddleware(req, res, next);
});
app.use(passport.initialize());
app.use((req, res, next) => {
  if (isPublicReadRequest(req)) return next();
  return passportSessionMiddleware(req, res, next);
});

const iconPath = path.join(__dirname, "../../comix-web/public/public/source-icons");
app.use("/public/source-icons", express.static(iconPath));

const publicPath = path.join(__dirname, "../../comix-web/public");
app.use("/public", express.static(publicPath));

const iconPath2 = path.join(__dirname, "../../comix-web/public/public");
app.use("/public/public", express.static(iconPath2));

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
      logger.error({ status: upstream.status, contentType: ct }, "AllManga video proxy got Cloudflare challenge");
      if (!res.headersSent) res.status(502).json({ error: "Video source is temporarily unavailable." });
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
  } catch {
    logger.error("AllManga video proxy failed");
    if (!res.headersSent) return res.status(502).json({ error: "Failed to stream AllManga video" });
    return;
  }
});

// Pawchive videos need the source referer and byte-range support. Direct CDN
// URLs may appear to load forever in browsers that refuse the cross-origin
// response, while a stream proxy also makes seeking and mobile playback work.
app.get("/api/source-video", async (req, res) => {
  if (String(req.query.source ?? "") !== "all.pawchive") {
    return res.status(403).json({ error: "Video source is not allowed" });
  }
  const rawUrl = String(req.query.url ?? "");
  let target: URL;
  try { target = new URL(rawUrl); } catch { return res.status(400).json({ error: "Invalid video URL" }); }
  if (target.protocol !== "https:" || !["file.pawchive.pw", "pawchive.pw"].includes(target.hostname)) {
    return res.status(403).json({ error: "Video host is not allowed" });
  }
  try {
    const range = req.headers.range;
    const upstream = await axios.get(target.toString(), {
      responseType: "stream",
      headers: {
        Referer: "https://pawchive.pw/",
        Origin: "https://pawchive.pw",
        "User-Agent": VIDEO_PROXY_UA,
        Accept: "video/*,application/octet-stream;q=0.9,*/*;q=0.5",
        ...(range ? { Range: range } : {}),
      },
      timeout: 120_000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const contentType = String(upstream.headers["content-type"] ?? "");
    if (upstream.status >= 400 || contentType.includes("text/html")) {
      (upstream.data as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      return res.status(502).json({ error: "Pawchive video is temporarily unavailable" });
    }
    res.status(upstream.status);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");
    for (const header of ["content-type", "content-length", "content-range"]) {
      if (upstream.headers[header]) res.setHeader(header, upstream.headers[header] as string);
    }
    (upstream.data as NodeJS.ReadableStream).pipe(res);
    (upstream.data as NodeJS.ReadableStream).on("error", () => { if (!res.headersSent) res.status(502).end(); });
    return;
  } catch {
    logger.error("Pawchive video proxy failed");
    if (!res.headersSent) return res.status(502).json({ error: "Failed to stream Pawchive video" });
    return;
  }
});

// AnimeGG embeds require their original popup/player bootstrap behavior. Proxy
// only the allow-listed embed page, but do not sanitize its scripts: removing
// window.open/popunder code makes the episode player fail to initialize.
app.get("/api/animegg/embed", async (req, res) => {
  const rawUrl = String(req.query.url ?? "");
  let target: URL;
  try { target = new URL(rawUrl); } catch { return res.status(400).send("Invalid AnimeGG embed URL"); }
  if (target.protocol !== "https:" || target.hostname !== "www.animegg.org" || !/^\/embed\//.test(target.pathname)) {
    return res.status(403).send("AnimeGG embed URL is not allowed");
  }
  try {
    const upstream = await axios.get<string>(target.toString(), {
      timeout: 20_000,
      headers: { "User-Agent": VIDEO_PROXY_UA, Referer: "https://www.animegg.org/" },
      responseType: "text",
    });
    const $ = cheerio.load(upstream.data);
    if ($("head base").length === 0) $("head").prepend(`<base href="${target.origin}${target.pathname.replace(/[^/]+$/, "")}">`);
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.send($.html());
  } catch {
    return res.status(502).send("AnimeGG player is temporarily unavailable");
  }
});

// ── Source image proxy ──────────────────────────────────────────────────────
// Some source CDNs reject browser image requests when the source referer is
// missing (notably Webtoons). Keep this proxy narrowly allow-listed.
type SourceMediaPolicy = {
  hosts: string[];
  referer: string;
  extraPortsByHost?: Record<string, number[]>;
};
const SOURCE_MEDIA_HOSTS: Record<string, SourceMediaPolicy> = {
  "all.pawchive": { hosts: ["img.pawchive.pw", "file.pawchive.pw"], referer: "https://pawchive.pw/" },
  "all.webtoons": { hosts: ["webtoon-phinf.pstatic.net", "swebtoon-phinf.pstatic.net"], referer: "https://www.webtoons.com/" },
  "en.novelfull": { hosts: ["novelfull.com", ".novelfull.com"], referer: "https://novelfull.com/" },
  // MangaDex covers use uploads.mangadex.org; chapter pages are served from
  // rotating HTTPS subdomains of mangadex.network.
  "all.mangadex": { hosts: ["uploads.mangadex.org", ".mangadex.network"], referer: "https://mangadex.org/" },
  "en.asurascans": { hosts: [".asurascans.com"], referer: "https://asurascans.com/" },
  "all.thunderscans": { hosts: ["en-thunderscans.com", ".thunderscans.com"], referer: "https://en-thunderscans.com/" },
  "en.animegg": {
    hosts: ["vidcache.net", ".vidcache.net", "animegg.org", ".animegg.org"],
    // AnimeGG's public URL redirects to sharded CDN hosts on port 8166.
    extraPortsByHost: { "vidcache.net": [8161], ".vidcache.net": [8166] },
    referer: "https://www.animegg.org/",
  },
};

type MediaCacheEntry = { body: Buffer; contentType: string; expiresAt: number };
const sourceMediaCache = new Map<string, MediaCacheEntry>();
const sourceMediaInflight = new Map<string, Promise<MediaCacheEntry>>();
const SOURCE_MEDIA_CACHE_TTL = 6 * 60 * 60 * 1000;
const SOURCE_MEDIA_CACHE_MAX = 160;
const SOURCE_MEDIA_CACHE_MAX_BYTES = 1024 * 1024;

function isAllowedSourceMediaUrl(target: URL, source: SourceMediaPolicy): boolean {
  const hostname = target.hostname.toLowerCase();
  const allowedHost = source.hosts.some(host => {
    const normalizedHost = host.toLowerCase();
    return normalizedHost.startsWith(".")
      ? hostname.endsWith(normalizedHost)
      : hostname === normalizedHost;
  });
  const allowedPort = target.port === "" ||
    Object.entries(source.extraPortsByHost ?? {}).some(([host, ports]) => {
      const normalizedHost = host.toLowerCase();
      const matches = normalizedHost.startsWith(".")
        ? hostname.endsWith(normalizedHost)
        : hostname === normalizedHost;
      return matches && ports.includes(Number(target.port));
    });
  return target.protocol === "https:" && allowedPort && !target.username && !target.password && allowedHost;
}

async function fetchSourceMedia(sourceId: string, targetUrl: string, source: SourceMediaPolicy): Promise<MediaCacheEntry> {
  const key = `${sourceId}|${targetUrl}`;
  const hit = sourceMediaCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit;
  const pending = sourceMediaInflight.get(key);
  if (pending) return pending;
  const request = (async () => {
    let current = new URL(targetUrl);
    const visited = new Set<string>();
    let status = 0;
    let contentType = "";
    let data: ArrayBuffer | undefined;

    for (let redirects = 0; redirects <= 5; redirects += 1) {
      current.hash = "";
      if (!isAllowedSourceMediaUrl(current, source)) {
        throw new Error("Source media URL or redirect destination is not allowed");
      }
      const requestUrl = current.toString();
      if (visited.has(requestUrl)) throw new Error("Source media redirect loop");
      visited.add(requestUrl);

      const upstream = await axios.get<ArrayBuffer>(requestUrl, {
        responseType: "arraybuffer",
        headers: { Referer: source.referer, Origin: new URL(source.referer).origin, "User-Agent": VIDEO_PROXY_UA, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
        timeout: 45_000, maxRedirects: 0, validateStatus: () => true,
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        const location = String(upstream.headers["location"] ?? "");
        if (!location || redirects === 5) throw new Error("Source media redirect is invalid or exceeds the redirect limit");
        const next = new URL(location, current);
        next.hash = "";
        if (!isAllowedSourceMediaUrl(next, source)) {
          throw new Error("Source media redirect destination is not allowed");
        }
        current = next;
        continue;
      }

      status = upstream.status;
      contentType = String(upstream.headers["content-type"] ?? "");
      data = upstream.data;
      break;
    }

    if (data === undefined) throw new Error("Source media redirect limit reached");
    if (status >= 400 || contentType.toLowerCase().includes("text/html")) throw new Error("Source media is temporarily unavailable");
    const body = Buffer.from(data);
    if (body.length > 12 * 1024 * 1024) throw new Error("Source media is too large");
    // Pawchive's GIF thumbnail route returns a one-frame WebP but can label it
    // image/gif. Correct the MIME so browsers reliably decode the frozen cover.
    if (
      sourceId === "all.pawchive" &&
      body.subarray(0, 4).toString("ascii") === "RIFF" &&
      body.subarray(8, 12).toString("ascii") === "WEBP"
    ) contentType = "image/webp";
    const entry = { body, contentType: contentType || "application/octet-stream", expiresAt: Date.now() + SOURCE_MEDIA_CACHE_TTL };
    if (body.length <= SOURCE_MEDIA_CACHE_MAX_BYTES) {
      if (sourceMediaCache.size >= SOURCE_MEDIA_CACHE_MAX && !sourceMediaCache.has(key)) {
        const oldest = sourceMediaCache.keys().next().value;
        if (oldest) sourceMediaCache.delete(oldest);
      }
      sourceMediaCache.set(key, entry);
    }
    return entry;
  })().finally(() => sourceMediaInflight.delete(key));
  sourceMediaInflight.set(key, request);
  return request;
}

app.get("/api/source-media", async (req, res) => {
  const sourceId = String(req.query.source ?? "");
  const targetUrl = String(req.query.url ?? "");
  const source = SOURCE_MEDIA_HOSTS[sourceId];
  if (!source || !targetUrl) return res.status(400).json({ error: "source and url are required" });
  let target: URL;
  try { target = new URL(targetUrl); } catch { return res.status(400).json({ error: "Invalid media URL" }); }
  if (!isAllowedSourceMediaUrl(target, source)) {
    return res.status(403).json({ error: "Media host is not allowed for this source" });
  }
  if (sourceId === "all.pawchive" && /\.(mp4|webm|mov|mkv|avi|m4v)(?:[?#&]|$)/i.test(target.toString())) {
    return res.status(415).json({ error: "Video files must use the streaming media route" });
  }
  try {
    const media = await fetchSourceMedia(sourceId, target.toString(), source);
    res.setHeader("Cache-Control", "public, max-age=21600, stale-while-revalidate=86400");
    res.setHeader("Content-Type", media.contentType);
    res.setHeader("Content-Length", media.body.length);
    return res.send(media.body);
  } catch {
    logger.error({ sourceId }, "Source media proxy failed");
    if (!res.headersSent) return res.status(502).json({ error: "Failed to fetch source media" });
    return;
  }
});

// Optional Web Helper fallback. The browser helper performs the same request
// directly; this route keeps ordinary browsers functional without requiring a
// source-site CORS policy. Only public HTTPS hosts are accepted.
function blockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return true;
}

app.all("/api/direct-fetch", async (req, res) => {
  const rawTarget = typeof req.query.url === "string" ? req.query.url : "";
  let target: URL;
  try {
    target = new URL(rawTarget);
    if (target.protocol !== "https:" || target.hostname === "localhost" || target.hostname.endsWith(".local")) {
      return res.status(400).json({ error: "Only public HTTPS targets are allowed" });
    }
    const addresses = await dns.lookup(target.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(entry => blockedAddress(entry.address))) {
      return res.status(400).json({ error: "Target host is not publicly routable" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid target URL" });
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (["host", "origin", "referer", "content-length", "connection"].includes(lower)) continue;
    if (typeof value === "string") headers.set(name, value);
  }
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body != null) {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  try {
    const upstream = await fetch(target.href, { method: req.method, headers, body, redirect: "follow" });
    for (const [name, value] of upstream.headers.entries()) {
      if (!["content-length", "content-encoding", "transfer-encoding", "set-cookie"].includes(name.toLowerCase())) res.setHeader(name, value);
    }
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    logger.warn({ target: target.hostname, error }, "Direct fetch fallback failed");
    return res.status(502).json({ error: "Upstream fetch failed" });
  }
});

app.use("/api", router);

if (process.env.NODE_ENV === "development") {
  // Development mode conditions remain here
}

export default app;
