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
 * The bypass server runs on localhost:3100 by default. Set BYPASS_SERVER_URL
 * to override.
 */

import axios, { type AxiosInstance } from "axios";

const BYPASS_URL = process.env["BYPASS_SERVER_URL"] || "http://localhost:3100";

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
let _healthChecked = false;
let _serverAvailable = false;

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
 * Check if the bypass server is running. Cached after first check.
 * Called automatically by fetchViaBypass — you don't need to call this directly.
 */
export async function isBypassAvailable(): Promise<boolean> {
  if (_healthChecked) return _serverAvailable;
  _healthChecked = true;
  try {
    const res = await client().get("/health", { timeout: 5_000 });
    _serverAvailable = res.status === 200 && res.data?.status === "ok";
  } catch {
    _serverAvailable = false;
  }
  return _serverAvailable;
}

/** Reset the health check cache (e.g., after the bypass server is started). */
export function resetBypassHealthCache(): void {
  _healthChecked = false;
  _serverAvailable = false;
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
