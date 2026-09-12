/**
 * Bypass Client
 * =============
 *
 * TypeScript wrapper for the Python Scrapling bypass server.
 *
 * When a source extension's normal HTTP request fails (403, Cloudflare
 * challenge page, empty JS-rendered page), it calls this client which
 * forwards the request to the Python bypass server running Scrapling's
 * StealthyFetcher — a headless Chromium that solves Cloudflare challenges
 * and renders JavaScript.
 *
 * Configure BYPASS_SERVER_URL only when running a separate local bypass
 * service; production does not depend on one.
 */

import axios, { type AxiosInstance } from "axios";

// Bypass support is optional. Configure BYPASS_SERVER_URL only for a local
// browser service; the main API must not depend on a separate hosted backend.
const BYPASS_URL = process.env["BYPASS_SERVER_URL"] || "";

export interface BypassFetchOptions {
  /** URL to fetch */
  url: string;
  /** Wait condition: 'network_idle' (default), 'dom_loaded', or 'none' */
  waitFor?: "network_idle" | "dom_loaded" | "none";
  /** Timeout in seconds (default: 60) */
  timeout?: number;
  /** Referer header to send */
  referer?: string;
  /** Extract image URLs from the rendered page */
  extractImages?: boolean;
  /** CSS selector to extract text content from */
  cssSelector?: string;
  /** Whether to solve Cloudflare challenges (default: true) */
  solveCloudflare?: boolean;
}

export interface BypassFetchResult {
  status: number;
  html: string;
  url: string;
  images: string[];
  text: string;
  error: string | null;
}

let _client: AxiosInstance | null = null;
let _lastCheckedAt = 0;
let _cachedAvailable = false;

/** Don't re-hit the health endpoint more often than this (ms). */
const HEALTH_CHECK_INTERVAL_MS = 5_000;
/** Timeout for a single health check (ms) — generous to tolerate cold starts. */
const HEALTH_CHECK_TIMEOUT_MS = 15_000;

function client(): AxiosInstance {
  if (!_client) {
    _client = axios.create({
      baseURL: BYPASS_URL,
      timeout: 120_000,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    });
  }
  return _client;
}

/**
 * Check if the bypass server is running.
 *
 * Re-checks the health endpoint on every call, but uses a short time-based
 * cache (HEALTH_CHECK_INTERVAL_MS) so a healthy server isn't hammered. A
 * negative result is never latched for the process lifetime — if the server
 * becomes reachable later (cold start, network blip, env fix), a subsequent
 * call will rediscover it once the interval has elapsed.
 *
 * Called automatically by fetchViaBypass — you don't need to call this directly.
 */
export async function isBypassAvailable(): Promise<boolean> {
  if (!BYPASS_URL) return false;
  const now = Date.now();
  if (now - _lastCheckedAt < HEALTH_CHECK_INTERVAL_MS) {
    return _cachedAvailable;
  }
  _lastCheckedAt = now;
  try {
    const res = await client().get("/health", { timeout: HEALTH_CHECK_TIMEOUT_MS });
    _cachedAvailable = res.status === 200 && res.data?.status === "ok";
  } catch {
    _cachedAvailable = false;
  }
  return _cachedAvailable;
}

/** Reset the health check cache (e.g., after the bypass server is started). */
export function resetBypassHealthCache(): void {
  _lastCheckedAt = 0;
  _cachedAvailable = false;
}

/**
 * Fetch a URL through the Python Scrapling bypass server.
 *
 * This uses StealthyFetcher (headless Chromium with Cloudflare solving).
 * Returns the fully rendered page HTML, extracted images, or text.
 *
 * @throws Error if the bypass server is not running or the fetch fails.
 */
export async function fetchViaBypass(opts: BypassFetchOptions): Promise<BypassFetchResult> {
  const available = await isBypassAvailable();
  if (!available) {
    throw new Error("Bypass server is not running. Start it with: cd artifacts/bypass-server && python main.py");
  }

  const res = await client().post<BypassFetchResult>("/fetch", {
    url: opts.url,
    wait_for: opts.waitFor ?? "network_idle",
    timeout: opts.timeout ?? 60,
    referer: opts.referer ?? null,
    extract_images: opts.extractImages ?? false,
    css_selector: opts.cssSelector ?? null,
    solve_cloudflare: opts.solveCloudflare ?? true,
  });

  if (res.status >= 400 || res.data?.error) {
    throw new Error(`Bypass fetch failed: ${res.data?.error ?? `HTTP ${res.status}`}`);
  }

  return res.data;
}

/**
 * Fetch a URL through the bypass server and return rendered HTML.
 * Convenience wrapper for the most common use case: getting page HTML
 * after JavaScript rendering and Cloudflare bypass.
 */
export async function fetchHtmlViaBypass(
  url: string,
  opts?: Partial<BypassFetchOptions>,
): Promise<string> {
  const result = await fetchViaBypass({ url, ...opts });
  return result.html;
}

/**
 * Fetch a URL through the bypass server and extract image URLs.
 * Convenience wrapper for sources that need to get page images from
 * JS-rendered pages (e.g., ComickFan chapter pages).
 */
export async function fetchImagesViaBypass(
  url: string,
  opts?: Partial<BypassFetchOptions>,
): Promise<string[]> {
  const result = await fetchViaBypass({ url, extractImages: true, ...opts });
  return result.images;
}
