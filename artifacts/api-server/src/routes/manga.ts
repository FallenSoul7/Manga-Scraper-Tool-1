import { Router, type IRouter, type Request, type Response } from "express";
import axios from "axios";
import dns from "node:dns";
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
  const sort = typeof req.query["sort"] === "string" ? req.query["sort"] : undefined;
  return {
    page: parsePage(req.query["page"]),
    nsfw: parseBool(req.query["nsfw"], false),
    poster: parsePoster(req.query["poster"]),
    tagIds: parseTagIds(req),
    sort,
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

// ---------------------------------------------------------------------------
// SSRF protection — hostname string check + DNS resolution
// ---------------------------------------------------------------------------

/** Returns true if an IPv4 dotted-decimal string falls in a private/reserved range. */
function isPrivateIPv4(a: number, b: number): boolean {
  if (a === 10) return true;                        // 10.0.0.0/8
  if (a === 127) return true;                       // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;          // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  if (a === 0) return true;                         // 0.0.0.0/8 "this" network
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true;                        // 224+/4 multicast + 240+/4 reserved
  return false;
}

/**
 * Returns true if an IP string (v4 or v6, including IPv6-mapped IPv4) falls
 * in a private, loopback, link-local, multicast, or otherwise reserved range.
 * Handles:
 *  - Plain IPv4 dotted decimal
 *  - IPv6-mapped IPv4 dotted form  (::ffff:127.0.0.1)
 *  - IPv6-mapped IPv4 hex form     (::ffff:7f00:0001)
 *  - IPv6 loopback, ULA, link-local, multicast
 */
function isPrivateIP(ip: string): boolean {
  const h = ip.toLowerCase().trim();

  // Literal names / unspecified
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "::" || h === "") return true;

  // IPv6-mapped IPv4: ::ffff:<dotted> or ::ffff:<hex16>:<hex16>
  if (h.startsWith("::ffff:")) {
    const rest = h.slice(7); // drop "::ffff:"
    if (rest.includes(".")) {
      // dotted decimal form: ::ffff:127.0.0.1
      const m = rest.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (m) return isPrivateIPv4(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
    } else {
      // hex form: ::ffff:7f00:0001  → bytes [0x7f, 0x00, 0x00, 0x01]
      const parts = rest.split(":");
      if (parts.length === 2) {
        const hi = parseInt(parts[0]!, 16);
        const lo = parseInt(parts[1]!, 16);
        if (!isNaN(hi) && !isNaN(lo)) {
          return isPrivateIPv4((hi >> 8) & 0xff, hi & 0xff);
        }
      }
    }
    // Any ::ffff: form we couldn't parse → reject to be safe
    return true;
  }

  // Plain IPv4 dotted decimal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return isPrivateIPv4(parseInt(m[1]!, 10), parseInt(m[2]!, 10));

  // IPv6 private ranges
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("fe80:")) return true;  // link-local fe80::/10
  if (h.startsWith("ff")) return true;     // multicast ff00::/8

  // Any other IPv6 — allow (public unicast); DNS lookup already validates IPs
  return false;
}

/**
 * Validates a URL for use in the image proxy:
 * 1. Must be http(s), port 80/443 or default only.
 * 2. Hostname must not be a literal private IP.
 * 3. DNS resolution must not yield any private/loopback addresses.
 * Throws an Error with message "host not allowed" on any failure.
 */
async function validateImageUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error("invalid scheme");

  // Block non-standard ports (HTTPS=443, HTTP=80, or omitted)
  const port = parsed.port;
  if (port !== "" && port !== "80" && port !== "443") throw new Error("port not allowed");

  // Block literal private IPs in the hostname before DNS lookup
  if (isPrivateIP(parsed.hostname)) throw new Error("host not allowed");

  // Resolve DNS and verify none of the returned IPs are private.
  // This defeats DNS rebinding — we fail closed (reject) on any lookup error.
  try {
    const records = await dns.promises.lookup(parsed.hostname, { all: true });
    for (const { address } of records) {
      if (isPrivateIP(address)) throw new Error("host not allowed");
    }
  } catch (err: any) {
    // Re-throw our own rejection; for any DNS error also reject to be safe.
    throw new Error("host not allowed");
  }

  return parsed;
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
    // Disable automatic redirect following so we can validate redirect targets.
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
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
    if (!url) {
      res.status(400).send("invalid url");
      return;
    }

    // Validate URL and resolve DNS — throws "host not allowed" / "invalid url"
    // if the request would hit a private network address or invalid scheme.
    let parsed: URL;
    try {
      parsed = await validateImageUrl(url);
    } catch (err: any) {
      res.status(400).send(err.message ?? "invalid url");
      return;
    }

    let referer: string | undefined;
    try {
      const source = getSource(readSourceId(req));
      referer = source.imageReferer;
    } catch {
      /* ignore */
    }
    // Domain-based override: some CDNs require a specific Referer regardless
    // of which source was selected (e.g. reader fetches pages without X-Source).
    const h = parsed.hostname;
    if (h.endsWith("cdncmk.com")) referer = "https://comickfan.com/";
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
