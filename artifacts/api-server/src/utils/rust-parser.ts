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
}

export interface RustParserResult {
  title: string;
  url: string;
  cover: string | null;
  chapters: Array<{ title: string; url: string }>;
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
    && Array.isArray(result.chapters)
    && result.chapters.every((chapter) => {
      if (!chapter || typeof chapter !== "object") return false;
      const item = chapter as Record<string, unknown>;
      return typeof item.title === "string" && typeof item.url === "string";
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

function parseWithCheerio(input: RustParserInput): RustParserResult {
  const $ = cheerio.load(input.html);
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  const title = normalize($(input.titleSelector || "h1").first().text())
    || normalize($("title").first().text());
  let cover: string | null = null;
  const coverSelector = input.coverSelector || "img";
  for (const node of $(coverSelector).toArray()) {
    const selected = $(node);
    const image = selected.is("img") ? selected : selected.find("img").first();
    if (!image.length) continue;
    for (const attribute of ["data-lazy-src", "data-original", "data-src", "src"]) {
      const value = image.attr(attribute)?.trim();
      if (!value || value.startsWith("data:") || /placeholder|transparent|blank/i.test(value)) continue;
      cover = resolveUrl(input.url, value);
      if (cover) break;
    }
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
      const chapterTitle = normalize(link.text());
      if (!url || !chapterTitle || seen.has(url)) continue;
      seen.add(url);
      chapters.push({ title: chapterTitle, url });
    }
  }
  return { title, url: input.url, cover, chapters };
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
