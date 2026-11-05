import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";

export interface RustParserInput {
  html: string;
  url: string;
  titleSelector?: string;
  coverSelector?: string;
  chaptersSelector?: string;
  chapterTitleSelector?: string;
  chapterDateSelector?: string;
  itemsSelector?: string;
  itemTitleSelector?: string;
  itemCoverSelector?: string;
  hasNextPageSelector?: string;
}

export interface RustParserResult {
  title: string;
  url: string;
  cover: string | null;
  chapters: Array<{ title: string; url: string; date: string | null }>;
  items: Array<{ title: string; url: string; cover: string | null }>;
  hasNextPage: boolean;
}

export type RustParserFallback = () => RustParserResult | Promise<RustParserResult>;

const MAX_INPUT_BYTES = 2 * 1024 * 1024 + 64 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;

function parserBinary(): string | null {
  const relative = "crates/comihub-rust-scraper/target/release/comihub-parser";
  const candidates = [
    resolve(process.cwd(), "../../", relative),
    resolve(process.cwd(), relative),
    resolve(process.cwd(), "../../crates/comihub-rust-scraper/target/debug/comihub-parser"),
    resolve(process.cwd(), "crates/comihub-rust-scraper/target/debug/comihub-parser"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isResult(value: unknown): value is RustParserResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.title === "string"
    && typeof result.url === "string"
    && (typeof result.cover === "string" || result.cover === null)
    && typeof result.hasNextPage === "boolean"
    && Array.isArray(result.items)
    && result.items.every((item) => {
      if (!item || typeof item !== "object") return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.title === "string"
        && typeof entry.url === "string"
        && (typeof entry.cover === "string" || entry.cover === null);
    })
    && Array.isArray(result.chapters)
    && result.chapters.every((chapter) => {
      if (!chapter || typeof chapter !== "object") return false;
      const item = chapter as Record<string, unknown>;
      return typeof item.title === "string"
        && typeof item.url === "string"
        && (typeof item.date === "string" || item.date === null);
    });
}

function runParser(binary: string, input: RustParserInput): Promise<RustParserResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectResult(error);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        rejectOnce(new Error("Rust parser output exceeded the size limit."));
        return;
      }
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (Buffer.byteLength(stderr) < 4096) stderr += chunk;
    });
    child.on("error", rejectOnce);
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        rejectOnce(new Error(stderr.trim() || `Rust parser exited with status ${code ?? "unknown"}.`));
        return;
      }
      try {
        const result: unknown = JSON.parse(stdout);
        if (!isResult(result)) throw new Error("Rust parser returned an invalid result shape.");
        settled = true;
        resolveResult(result);
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error("Could not decode Rust parser output."));
      }
    });
    child.stdin.on("error", rejectOnce);
    child.stdin.end(JSON.stringify(input));
  });
}

function resolveUrl(base: string, value: string): string | null {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanTextValue(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  return /javascript\s+required|javascript:void\s*\(\s*0\s*\)/i.test(text) ? "" : text;
}

function cleanText(node: cheerio.Cheerio<any>): string {
  const clone = node.clone();
  clone.find("noscript").remove();
  return cleanTextValue(clone.text());
}

function backgroundUrl(node: cheerio.Cheerio<any>): string {
  const dataBg = node.attr("data-bg");
  const style = node.attr("style") || "";
  const value = dataBg || (style.toLowerCase().includes("background-image") ? style : "");
  const candidate = value.match(/url\(['"]?(.*?)['"]?\)/i)?.[1]?.trim() || value.trim();
  return candidate && !/^(?:data:|javascript:)/i.test(candidate)
    && !/placeholder|transparent|blank/i.test(candidate) ? candidate : "";
}

function cardCover($: cheerio.CheerioAPI, card: cheerio.Cheerio<any>, imageSelector = "img"): string | null {
  const selected = card.is(imageSelector) ? card : card.find(imageSelector).first();
  const image = selected.is("img") ? selected : selected.find("img").first();
  let imageSource = "";
  for (const attribute of ["data-src", "data-original", "data-bg", "src", "data-lazy-src"]) {
    const value = image.attr(attribute)?.trim();
    if (value && !/^(?:data:|javascript:)/i.test(value) && !/placeholder|transparent|blank/i.test(value)) {
      imageSource = value.split(",")[0].trim().split(/\s+/)[0];
      break;
    }
  }
  const nodes = [card, ...card.find("[data-bg], [style]").toArray().map((element) => $(element))];
  const background = nodes.map(backgroundUrl).find(Boolean) || "";
  const width = Number(image.attr("width") || image.attr("data-width") || 0);
  const height = Number(image.attr("height") || image.attr("data-height") || 0);
  const snapshot = (width > 0 && height > 0 && width / height >= 2)
    || /(?:layout|snapshot|full[-_]?section|slider|trending|popular|hero|banner)(?:[-_./?]|$)/i.test(imageSource);
  const candidate = background && (!imageSource || snapshot) ? background : imageSource || background;
  return candidate || null;
}

function parseWithCheerio(input: RustParserInput): RustParserResult {
  const $ = cheerio.load(input.html);
  const title = cleanText($(input.titleSelector || "h1").first()) || cleanText($("title").first());
  let cover: string | null = null;
  const coverSelector = input.coverSelector || "img";
  for (const node of $(coverSelector).toArray()) {
    const raw = cardCover($, $(node));
    if (raw) cover = resolveUrl(input.url, raw);
    if (cover) break;
  }

  const chapters: RustParserResult["chapters"] = [];
  const seen = new Set<string>();
  if (input.chaptersSelector) {
    for (const node of $(input.chaptersSelector).toArray().slice(0, 300)) {
      const item = $(node);
      const link = item.is("a[href]") ? item : item.find("a[href]").first();
      const href = link.attr("href");
      const url = href ? resolveUrl(input.url, href) : null;
      if (!href || /javascript:void\s*\(\s*0\s*\)/i.test(href)) continue;
      const chapterTitle = (input.chapterTitleSelector ? cleanText(item.find(input.chapterTitleSelector).first()) : "")
        || cleanText(link);
      if (!url || !chapterTitle || seen.has(url)) continue;
      seen.add(url);
      const date = input.chapterDateSelector ? cleanText(item.find(input.chapterDateSelector).first()) || null : null;
      chapters.push({ title: chapterTitle, url, date });
    }
  }

  const items: RustParserResult["items"] = [];
  const itemSeen = new Set<string>();
  if (input.itemsSelector) {
    for (const node of $(input.itemsSelector).toArray().slice(0, 200)) {
      const item = $(node);
      const link = item.is("a[href]") ? item : item.find("a[href]").first();
      const href = link.attr("href");
      const itemUrl = href && !/javascript:void\s*\(\s*0\s*\)/i.test(href) ? resolveUrl(input.url, href) : null;
      const itemTitle = cleanTextValue(link.attr("title") || "")
        || (input.itemTitleSelector ? cleanText(item.find(input.itemTitleSelector).first()) : "")
        || cleanText(link);
      if (!itemUrl || !itemTitle || itemSeen.has(itemUrl)) continue;
      itemSeen.add(itemUrl);
      const rawCover = cardCover($, item, input.itemCoverSelector || "img");
      items.push({ title: itemTitle, url: itemUrl, cover: rawCover ? resolveUrl(input.url, rawCover) : null });
    }
  }

  const hasNextPage = input.hasNextPageSelector ? $(input.hasNextPageSelector).length > 0 : false;
  return { title, url: input.url, cover, chapters, items, hasNextPage };
}

export async function parseHtmlWithRust(
  input: RustParserInput,
  fallback?: RustParserFallback,
): Promise<RustParserResult> {
  const useFallback = () => fallback ? fallback() : parseWithCheerio(input);
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_INPUT_BYTES) return useFallback();
  const binary = parserBinary();
  if (!binary) return useFallback();
  try {
    return await runParser(binary, input);
  } catch {
    // Includes ENOENT/ETXTBSY while the Render build is creating the binary.
    return useFallback();
  }
}
