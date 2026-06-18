import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import * as cheerio from "cheerio";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type CheerioRoot = cheerio.CheerioAPI;

export function makeHttp(baseURL: string, extraHeaders: Record<string, string> = {}): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 25000,
    maxRedirects: 5,
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: baseURL.endsWith("/") ? baseURL : `${baseURL}/`,
      ...extraHeaders,
    },
    validateStatus: (s) => s >= 200 && s < 500,
  });
}

export async function fetchHtml(
  http: AxiosInstance,
  url: string,
  config: AxiosRequestConfig = {},
): Promise<{ $: CheerioRoot; finalUrl: string; html: string }> {
  const res = await http.get(url, { responseType: "text", ...config });
  if (res.status >= 400) {
    throw new Error(`Upstream returned HTTP ${res.status} for ${url}`);
  }
  const html = typeof res.data === "string" ? res.data : String(res.data);
  return { $: cheerio.load(html), finalUrl: res.request?.res?.responseUrl || url, html };
}

export async function fetchJson<T>(
  http: AxiosInstance,
  url: string,
  config: AxiosRequestConfig = {},
): Promise<T> {
  const res = await http.get<T>(url, {
    responseType: "json",
    headers: { Accept: "application/json", ...(config.headers || {}) },
    ...config,
  });
  if (res.status >= 400) throw new Error(`Upstream returned HTTP ${res.status} for ${url}`);
  return res.data as T;
}

/** Resolve a possibly-relative href against a base URL. */
export function absUrl(base: string, href: string | undefined | null): string {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Pull the manga slug out of a fully-qualified URL (last non-empty path segment). */
export function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || u.pathname;
  } catch {
    const parts = url.split("/").filter(Boolean);
    return parts[parts.length - 1] || url;
  }
}

/** Convert a string ID like "asura/series/the-beginning-after-the-end" → encoded id. */
export function packId(...parts: string[]): string {
  return parts.map((p) => encodeURIComponent(p)).join(":");
}
export function unpackId(id: string): string[] {
  return id.split(":").map(decodeURIComponent);
}

/** Try several attributes (img-data-src, data-lazy-src, src) to find a real image URL. */
export function imgAttr($el: cheerio.Cheerio<any>): string {
  for (const attr of ["data-src", "data-lazy-src", "data-cfsrc", "src", "data-srcset"]) {
    const v = $el.attr(attr);
    if (v) return v.split(",")[0].trim().split(" ")[0];
  }
  return "";
}

/** Hash a string into a stable signed 32-bit integer ID */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h & 0x7fffffff;
}

/** Wraps an image URL in your backend proxy if needed. */
export function proxifyImage(originalUrl: string, referer: string, useProxy: boolean = false): string {
  if (!originalUrl) return "";
  if (!useProxy) return originalUrl;
  
  const encodedUrl = encodeURIComponent(originalUrl);
  const encodedRef = encodeURIComponent(referer);
  return `/api/proxy-image?url=${encodedUrl}&referer=${encodedRef}`;
}

// ==========================================
// Unified Extension Framework
// ==========================================

export interface MangaScraper {
  name: string;
  baseUrl: string;
  getDetails(): Promise<any>;
  getChapters(): Promise<any[]>;
  getPages(chapterUrl: string): Promise<{ images: string[]; alt_text?: string }>;
}

// Fixed absolute side-by-side relative path
import { XkcdScraper } from "./xkcd";

const registeredScrapers: Record<string, new (http: AxiosInstance) => MangaScraper> = {
  xkcd: XkcdScraper,
};

export class ScraperEngine {
  private static getSource(sourceKey: string): MangaScraper {
    const ScraperClass = registeredScrapers[sourceKey.toLowerCase()];
    if (!ScraperClass) {
      throw new Error(`Extension source '${sourceKey}' is not registered.`);
    }
    
    const dummyInstance = new ScraperClass(axios.create());
    const configuredHttp = makeHttp(dummyInstance.baseUrl);
    
    return new ScraperClass(configuredHttp);
  }

  static async getMangaDetails(sourceKey: string) {
    return await this.getSource(sourceKey).getDetails();
  }

  static async getChapterList(sourceKey: string) {
    return await this.getSource(sourceKey).getChapters();
  }

  static async getPageList(sourceKey: string, chapterUrl: string) {
    return await this.getSource(sourceKey).getPages(chapterUrl);
  }
}
