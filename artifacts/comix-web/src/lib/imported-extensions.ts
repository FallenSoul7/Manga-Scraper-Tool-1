import { useSyncExternalStore } from "react";
import { z } from "zod";
import type {
  ClientChapterResponse,
  ClientListResponse,
  ClientMangaDetail,
  ClientPageResponse,
  ClientSourceAdapter,
} from "./client-sources";
import { clientFetch } from "./client-fetch";
import { cacheExtensionManifest, removeCachedExtensionManifest } from "./extension-manifest-db";

export const APPROVED_GITHUB_OWNER = "FallenSoul7";
export const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 1536 * 1024;
const HTML_CACHE_TTL_MS = 2 * 60 * 1000;
const HTML_CACHE_MAX_ENTRIES = 8;
const STORAGE_KEY = "comihub:tier1-extensions:v1";
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/i;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const SELECTOR_RE = /^[^;{}\u0000-\u001f]{1,180}$/;
const URL_TEMPLATE_RE = /^[^\u0000-\u001f]{1,512}$/;
const ALLOWED_TEMPLATE_TOKENS = new Set(["page", "query"]);

const SelectorSchema = z.string().regex(SELECTOR_RE, "Use a CSS selector up to 180 characters.");
const OptionalSelectorSchema = SelectorSchema.optional();
const RouteTemplateSchema = z.string().min(1).max(512).regex(URL_TEMPLATE_RE);

/**
 * Tier 1 manifests are data, not plugins: only these bounded URL templates and
 * CSS selectors are accepted. Unknown fields fail validation and no manifest
 * string is ever evaluated, imported as code, or inserted into live HTML.
 */
export const Tier1ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.string().regex(SOURCE_ID_RE),
  sourceName: z.string().trim().min(1).max(80),
  baseUrl: z.string().min(1).max(2048),
  lang: z.string().regex(/^[A-Za-z]{2,3}$/).default("en"),
  isNsfw: z.boolean().default(false),
  description: z.string().max(280).optional(),
  iconUrl: z.string().min(1).max(2048).optional(),
  assetHosts: z.array(z.string().regex(HOST_RE)).max(20).default([]),
  routes: z.object({
    popular: RouteTemplateSchema,
    latest: RouteTemplateSchema,
    search: RouteTemplateSchema,
  }).strict(),
  selectors: z.object({
    mangaItems: SelectorSchema,
    mangaTitle: SelectorSchema,
    mangaLink: SelectorSchema,
    mangaImage: OptionalSelectorSchema,
    detailImage: OptionalSelectorSchema,
    nextPage: OptionalSelectorSchema,
    detailTitle: OptionalSelectorSchema,
    detailAuthor: OptionalSelectorSchema,
    detailArtist: OptionalSelectorSchema,
    detailSynopsis: OptionalSelectorSchema,
    detailStatus: OptionalSelectorSchema,
    detailGenres: OptionalSelectorSchema,
    chapterList: SelectorSchema,
    chapterLink: OptionalSelectorSchema,
    chapterTitle: OptionalSelectorSchema,
    chapterNumber: OptionalSelectorSchema,
    chapterDate: OptionalSelectorSchema,
    chapterImages: SelectorSchema,
  }).strict(),
}).strict();

export type Tier1Manifest = z.infer<typeof Tier1ManifestSchema>;

export interface ImportedTier1Extension {
  sourceId: string;
  manifestUrl: string;
  importedAt: number;
  manifest: Tier1Manifest;
}

export interface LoadedTier1Manifest {
  sourceId: string;
  manifestUrl: string;
  manifest: Tier1Manifest;
}

export type ManifestUrlResult =
  | { ok: true; url: URL; owner: string; repo: string }
  | { ok: false; error: string };

export type LoadedManifestResult =
  | { ok: true; loaded: LoadedTier1Manifest }
  | { ok: false; error: string };

export type SaveManifestResult =
  | { ok: true; extension: ImportedTier1Extension; replaced: boolean }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicDnsHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!HOST_RE.test(host)) return false;
  if (
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") ||
    host.endsWith(".example") || /^[0-9.]+$/.test(host) || host.includes(":")
  ) return false;
  return true;
}

function isSafeHttpsUrl(value: string, allowPath: boolean): URL | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    !isPublicDnsHost(url.hostname) || url.search || url.hash || (!allowPath && url.pathname !== "/")
  ) return null;
  return url;
}

function validateRouteTemplate(template: string, requiredToken: "page" | "query"): boolean {
  const tokens = Array.from(template.matchAll(/\{([^{}]+)\}/g), match => match[1]);
  if (tokens.some(token => !ALLOWED_TEMPLATE_TOKENS.has(token))) return false;
  if ((template.match(/[{}]/g) ?? []).length !== tokens.length * 2) return false;
  return tokens.includes(requiredToken);
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid Tier 1 source manifest.";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

export function validateManifestUrl(input: string): ManifestUrlResult {
  if (input.trim().length > 2048) return { ok: false, error: "The manifest URL is too long." };
  let url: URL;
  try { url = new URL(input.trim()); } catch {
    return { ok: false, error: "Paste a complete raw.githubusercontent.com JSON URL." };
  }
  if (
    url.protocol !== "https:" || url.hostname.toLowerCase() !== "raw.githubusercontent.com" ||
    url.username || url.password || url.port || url.search || url.hash || url.pathname.includes("%")
  ) {
    return { ok: false, error: `Only HTTPS raw.githubusercontent.com links from ${APPROVED_GITHUB_OWNER} are accepted.` };
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts.some(part => part === "." || part === "..")) {
    return { ok: false, error: "Use the raw URL format: /FallenSoul7/<public-repo>/<branch>/<path>.json." };
  }
  const [owner, repo] = parts;
  if (!owner || owner.toLowerCase() !== APPROVED_GITHUB_OWNER.toLowerCase()) {
    return { ok: false, error: `Manifest files must be hosted under the approved GitHub account ${APPROVED_GITHUB_OWNER}.` };
  }
  if (!repo || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || !url.pathname.toLowerCase().endsWith(".json")) {
    return { ok: false, error: "The approved GitHub path must point to a .json file in a repository." };
  }
  return { ok: true, url, owner, repo };
}

function deriveSourceId(repo: string, manifestId: string): string {
  const normalizedRepo = repo.toLowerCase();
  const normalizedManifestId = manifestId.toLowerCase();
  return `tier1.${normalizedRepo.length}-${normalizedRepo}.${normalizedManifestId.length}-${normalizedManifestId}`;
}

function validateManifest(value: unknown): { ok: true; manifest: Tier1Manifest } | { ok: false; error: string } {
  if (!isPlainObject(value)) return { ok: false, error: "The JSON file must contain one manifest object." };
  const parsed = Tier1ManifestSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const manifest = parsed.data;
  const baseUrl = isSafeHttpsUrl(manifest.baseUrl, true);
  if (!baseUrl) return { ok: false, error: "baseUrl must be a public HTTPS website URL without credentials, query, fragment, or custom port." };
  if (!manifest.routes.popular.includes("{page}") || !validateRouteTemplate(manifest.routes.popular, "page")) {
    return { ok: false, error: "routes.popular must contain {page} and use only the supported {page}/{query} placeholders." };
  }
  if (!manifest.routes.latest.includes("{page}") || !validateRouteTemplate(manifest.routes.latest, "page")) {
    return { ok: false, error: "routes.latest must contain {page} and use only the supported {page}/{query} placeholders." };
  }
  if (!manifest.routes.search.includes("{page}") || !validateRouteTemplate(manifest.routes.search, "query")) {
    return { ok: false, error: "routes.search must contain {query} and {page}." };
  }
  const sampleRoutes = Object.values(manifest.routes).map(template =>
    template.replaceAll("{page}", "1").replaceAll("{query}", "sample"),
  );
  if (sampleRoutes.some(route => !resolvePageUrl(route, baseUrl.href, manifest))) {
    return { ok: false, error: "All routes must resolve to the same public HTTPS origin as baseUrl." };
  }
  for (const host of manifest.assetHosts) {
    if (!isPublicDnsHost(host)) return { ok: false, error: `assetHosts contains an invalid or non-public host: ${host}` };
  }
  if (manifest.iconUrl && !resolveAssetUrl(manifest.iconUrl, baseUrl.href, manifest)) {
    return { ok: false, error: "iconUrl must use HTTPS and the baseUrl host or an explicitly listed assetHosts entry." };
  }
  return { ok: true, manifest };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("The response is larger than the allowed size.");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("The response is larger than the allowed size.");
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("The response is larger than the allowed size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function fetchTier1Manifest(input: string): Promise<LoadedManifestResult> {
  const checked = validateManifestUrl(input);
  if (!checked.ok) return checked;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await clientFetch(checked.url.href, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json, text/plain;q=0.9" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `GitHub returned HTTP ${response.status}. The JSON file must be public and readable.` };
    const finalUrl = new URL(response.url || checked.url.href);
    if (finalUrl.origin !== "https://raw.githubusercontent.com" || finalUrl.href !== checked.url.href) {
      return { ok: false, error: "The manifest URL redirected. Redirected manifest URLs are not accepted." };
    }
    const text = await readBoundedText(response, MAX_MANIFEST_BYTES);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
      return { ok: false, error: "The GitHub response is not valid JSON." };
    }
    const validation = validateManifest(raw);
    if (!validation.ok) return validation;
    return {
      ok: true,
      loaded: {
        sourceId: deriveSourceId(checked.repo, validation.manifest.sourceId),
        manifestUrl: checked.url.href,
        manifest: validation.manifest,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: "Fetching the manifest timed out after 12 seconds." };
    const message = error instanceof Error ? error.message : "network error";
    return { ok: false, error: `Could not fetch the public manifest. Check the URL, GitHub visibility, and browser access: ${message}` };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function validateStoredRecord(value: unknown): ImportedTier1Extension | null {
  if (!isPlainObject(value)) return null;
  const parsed = z.object({
    sourceId: z.string().min(1).max(180),
    manifestUrl: z.string().min(1).max(2048),
    importedAt: z.number().finite(),
    manifest: Tier1ManifestSchema,
  }).strict().safeParse(value);
  if (!parsed.success) return null;
  const checkedUrl = validateManifestUrl(parsed.data.manifestUrl);
  const checkedManifest = validateManifest(parsed.data.manifest);
  if (!checkedUrl.ok || !checkedManifest.ok) return null;
  const expectedId = deriveSourceId(checkedUrl.repo, checkedManifest.manifest.sourceId);
  if (parsed.data.sourceId !== expectedId) return null;
  return { ...parsed.data, manifestUrl: checkedUrl.url.href, manifest: checkedManifest.manifest };
}

function readStored(): ImportedTier1Extension[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(validateStoredRecord).filter((entry): entry is ImportedTier1Extension => entry !== null);
  } catch {
    return [];
  }
}

let snapshot = readStored();
const listeners = new Set<() => void>();
function publish(next: ImportedTier1Extension[]): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  snapshot = next;
  for (const listener of listeners) listener();
  return true;
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = readStored();
    for (const listener of listeners) listener();
  });
}

export function useImportedTier1Extensions(): ImportedTier1Extension[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function getImportedTier1Extensions(): ImportedTier1Extension[] {
  return snapshot;
}

export function getImportedTier1Extension(sourceId: string): ImportedTier1Extension | null {
  const entry = snapshot.find(item => item.sourceId === sourceId);
  return entry ? validateStoredRecord(entry) : null;
}

export function saveImportedTier1Extension(loaded: LoadedTier1Manifest): SaveManifestResult {
  const checkedUrl = validateManifestUrl(loaded.manifestUrl);
  const checkedManifest = validateManifest(loaded.manifest);
  if (!checkedUrl.ok) return checkedUrl;
  if (!checkedManifest.ok) return checkedManifest;
  const sourceId = deriveSourceId(checkedUrl.repo, checkedManifest.manifest.sourceId);
  if (sourceId !== loaded.sourceId) return { ok: false, error: "The source ID does not match the approved manifest URL." };
  const extension: ImportedTier1Extension = {
    sourceId,
    manifestUrl: checkedUrl.url.href,
    importedAt: Date.now(),
    manifest: checkedManifest.manifest,
  };
  const replaced = snapshot.some(item => item.sourceId === sourceId);
  const next = replaced
    ? snapshot.map(item => item.sourceId === sourceId ? extension : item)
    : [...snapshot, extension];
  if (!publish(next)) return { ok: false, error: "This browser could not save the manifest locally. Check local storage settings or available device space, then try again." };
  void cacheExtensionManifest(sourceId, extension).catch(() => {});
  return { ok: true, extension, replaced };
}

export function removeImportedTier1Extension(sourceId: string): boolean {
  if (!snapshot.some(item => item.sourceId === sourceId)) return true;
  void removeCachedExtensionManifest(sourceId).catch(() => {});
  return publish(snapshot.filter(item => item.sourceId !== sourceId));
}

export function tier1InstalledMetadata(extension: ImportedTier1Extension) {
  const baseUrl = new URL(extension.manifest.baseUrl);
  const iconUrl = extension.manifest.iconUrl
    ? resolveAssetUrl(extension.manifest.iconUrl, baseUrl.href, extension.manifest)
    : null;
  return {
    id: extension.sourceId,
    name: extension.manifest.sourceName,
    lang: extension.manifest.lang,
    languages: [extension.manifest.lang],
    adapter: "tier1-html",
    manifestVersion: extension.manifest.schemaVersion,
    isNsfw: extension.manifest.isNsfw,
    iconUrl,
    isPinned: false,
  };
}

function resolveAssetUrl(value: string, reference: string, manifest: Tier1Manifest): string | null {
  let url: URL;
  try { url = new URL(value, reference); } catch { return null; }
  const base = new URL(manifest.baseUrl);
  const allowedHosts = new Set([base.hostname.toLowerCase(), ...manifest.assetHosts.map(host => host.toLowerCase())]);
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    !isPublicDnsHost(url.hostname) || !allowedHosts.has(url.hostname.toLowerCase())
  ) return null;
  return url.href;
}

function resolvePageUrl(value: string, reference: string, manifest: Tier1Manifest): string | null {
  let url: URL;
  try { url = new URL(value, reference); } catch { return null; }
  const base = new URL(manifest.baseUrl);
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    !isPublicDnsHost(url.hostname) || url.origin !== base.origin
  ) return null;
  return url.href;
}

function readNodeText(root: ParentNode, selector: string | undefined): string {
  if (!selector) return "";
  try { return root.querySelector(selector)?.textContent?.trim().slice(0, 4000) ?? ""; }
  catch { throw new Error(`Invalid CSS selector: ${selector}`); }
}

function findImageValue(element: Element | null): string {
  if (!element) return "";
  const candidates = ["data-url", "data-src", "data-original", "data-lazy-src", "data-srcset", "srcset", "src"]
    .map(attribute => element.getAttribute(attribute)?.trim() ?? "")
    .filter(Boolean);
  const candidate = candidates.find(value => !value.startsWith("data:") && !/transparent|blank|placeholder/i.test(value)) ?? "";
  return candidate.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

function selectWithin(root: ParentNode, selector: string | undefined): Element | null {
  if (!selector) return null;
  try { return root.querySelector(selector); }
  catch { throw new Error(`Invalid CSS selector: ${selector}`); }
}

function selectAll(root: ParentNode, selector: string): Element[] {
  try { return Array.from(root.querySelectorAll(selector)); }
  catch { throw new Error(`Invalid CSS selector: ${selector}`); }
}

function sourceText(element: Element | null): string {
  return element?.textContent?.trim().replace(/\s+/g, " ").slice(0, 2000) ?? "";
}

const htmlCache = new Map<string, { text: string; expiresAt: number }>();

async function fetchHtml(manifest: Tier1Manifest, url: string, sourceId: string): Promise<Document> {
  const checkedUrl = resolvePageUrl(url, manifest.baseUrl, manifest);
  if (!checkedUrl) throw new Error("The page URL is outside the source's approved HTTPS origin.");
  const key = `${sourceId}:${checkedUrl}`;
  const cached = htmlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return new DOMParser().parseFromString(cached.text, "text/html");
  if (cached) htmlCache.delete(key);

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await clientFetch(checkedUrl, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    const finalUrl = new URL(response.url || checkedUrl);
    if (finalUrl.origin !== new URL(manifest.baseUrl).origin || finalUrl.href !== checkedUrl) {
      throw new Error("The source redirected outside the approved origin; redirects are blocked.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("The source did not return an HTML page.");
    }
    const text = await readBoundedText(response, MAX_HTML_BYTES);
    htmlCache.set(key, { text, expiresAt: Date.now() + HTML_CACHE_TTL_MS });
    while (htmlCache.size > HTML_CACHE_MAX_ENTRIES) {
      const oldest = htmlCache.keys().next().value;
      if (!oldest) break;
      htmlCache.delete(oldest);
    }
    return new DOMParser().parseFromString(text, "text/html");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The source request timed out after 15 seconds.");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function buildListUrl(manifest: Tier1Manifest, kind: "popular" | "latest" | "search", page: number, query = ""): string {
  const template = manifest.routes[kind]
    .replaceAll("{page}", String(Math.max(1, Math.floor(page))))
    .replaceAll("{query}", encodeURIComponent(query));
  const url = resolvePageUrl(template, manifest.baseUrl, manifest);
  if (!url) throw new Error(`routes.${kind} must resolve to the approved baseUrl origin over HTTPS.`);
  return url;
}

function makeList(document: Document, page: number, manifest: Tier1Manifest, pageUrl: string): ClientListResponse {
  const { selectors } = manifest;
  const items = selectAll(document, selectors.mangaItems).slice(0, 100).flatMap((item, index) => {
    const titleNode = selectWithin(item, selectors.mangaTitle);
    const title = sourceText(titleNode);
    const linkNode = item.matches(selectors.mangaLink) ? item : selectWithin(item, selectors.mangaLink);
    const href = linkNode?.getAttribute("href")?.trim() ?? "";
    const id = href ? resolvePageUrl(href, pageUrl, manifest) : null;
    if (!title || !id) return [];
    const imageNode = selectWithin(item, selectors.mangaImage);
    const imageValue = findImageValue(imageNode);
    const thumbnail = imageValue ? resolveAssetUrl(imageValue, pageUrl, manifest) ?? "" : "";
    return [{ id, title, thumbnail, type: "Manga", isNsfw: manifest.isNsfw, mediaType: "manga" as const, key: `${id}:${index}` }];
  });
  const unique = new Map<string, typeof items[number]>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  const nextPage = selectors.nextPage ? selectWithin(document, selectors.nextPage) : null;
  const nextDisabled = nextPage?.getAttribute("aria-disabled") === "true" ||
    nextPage?.classList.contains("disabled") ||
    (nextPage?.tagName.toLowerCase() === "a" && ["", "#"].includes(nextPage.getAttribute("href")?.trim() ?? ""));
  return {
    page,
    hasNextPage: Boolean(nextPage) && !nextDisabled && page < 500,
    items: Array.from(unique.values()).map(({ key: _key, ...item }) => item),
  };
}

function parseChapterNumber(explicit: string, title: string, fallback: number): number {
  const candidate = explicit || title;
  const match = candidate.match(/(?:chapter|chap\.?|ch\.?|#)?\s*(\d+(?:\.\d+)?)/i);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) ? number : fallback;
}

function parseDate(element: Element | null): number {
  if (!element) return 0;
  const raw = element.getAttribute("datetime") || element.getAttribute("data-time") || sourceText(element);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export function createTier1ClientAdapter(extension: ImportedTier1Extension): ClientSourceAdapter {
  const { sourceId, manifest } = extension;
  const list = async (kind: "popular" | "latest" | "search", page: number, query = ""): Promise<ClientListResponse> => {
    const url = buildListUrl(manifest, kind, page, query);
    const document = await fetchHtml(manifest, url, sourceId);
    return makeList(document, page, manifest, url);
  };
  const fetchMangaPage = async (id: string) => {
    const url = resolvePageUrl(id, manifest.baseUrl, manifest);
    if (!url) throw new Error("Manga URL is outside the source's approved HTTPS origin.");
    return { url, document: await fetchHtml(manifest, url, sourceId) };
  };
  const adapter: ClientSourceAdapter = {
    sourceId,
    mode: "client",
    fallbackToServer: false,
    popular: page => list("popular", page),
    latest: page => list("latest", page),
    search: (query, page) => list("search", page, query),
    details: async (id, options): Promise<ClientMangaDetail> => {
      const { url, document } = await fetchMangaPage(id);
      const { selectors } = manifest;
      const title = readNodeText(document, selectors.detailTitle ?? selectors.mangaTitle) || manifest.sourceName;
      const thumbnailRaw = findImageValue(selectWithin(document, selectors.detailImage ?? selectors.mangaImage));
      const thumbnail = thumbnailRaw ? resolveAssetUrl(thumbnailRaw, url, manifest) ?? "" : "";
      const genres = selectors.detailGenres
        ? selectAll(document, selectors.detailGenres).map(sourceText).filter(Boolean).slice(0, 40)
        : [];
      const author = readNodeText(document, selectors.detailAuthor);
      return {
        id,
        title,
        author,
        artist: readNodeText(document, selectors.detailArtist) || author,
        synopsis: readNodeText(document, selectors.detailSynopsis),
        altTitles: [],
        status: readNodeText(document, selectors.detailStatus) || "Unknown",
        type: "Manga",
        isNsfw: manifest.isNsfw,
        rating: 0,
        thumbnail,
        genres,
        score: "",
        scorePosition: options?.scorePosition ?? "none",
        sourceTags: genres.map(name => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, group: "Genre" })),
        mediaType: "manga",
      };
    },
    chapters: async (id): Promise<ClientChapterResponse> => {
      const { url, document } = await fetchMangaPage(id);
      const { selectors } = manifest;
      return {
        items: selectAll(document, selectors.chapterList).slice(0, 1000).flatMap((item, index) => {
          const linkNode = item.matches(selectors.chapterLink ?? "a") ? item : selectWithin(item, selectors.chapterLink ?? "a");
          const href = linkNode?.getAttribute("href")?.trim() ?? "";
          const chapterUrl = href ? resolvePageUrl(href, url, manifest) : null;
          if (!chapterUrl) return [];
          const title = readNodeText(item, selectors.chapterTitle) || sourceText(linkNode) || `Chapter ${index + 1}`;
          const explicitNumber = readNodeText(item, selectors.chapterNumber);
          const number = parseChapterNumber(explicitNumber, title, index + 1);
          const dateNode = selectors.chapterDate ? selectWithin(item, selectors.chapterDate) : null;
          return [{
            id: chapterUrl,
            number,
            title,
            scanlator: "",
            date: parseDate(dateNode),
            isOfficial: false,
            lang: manifest.lang,
            mediaType: "image" as const,
          }];
        }),
      };
    },
    pages: async (chapterId): Promise<ClientPageResponse> => {
      const url = resolvePageUrl(chapterId, manifest.baseUrl, manifest);
      if (!url) throw new Error("Chapter URL is outside the source's approved HTTPS origin.");
      const document = await fetchHtml(manifest, url, sourceId);
      const pages = selectAll(document, manifest.selectors.chapterImages).slice(0, 500).flatMap((element, index) => {
        const raw = findImageValue(element);
        const pageUrl = raw ? resolveAssetUrl(raw, url, manifest) : null;
        return pageUrl ? [{ index, url: pageUrl }] : [];
      });
      if (!pages.length) throw new Error("No safe chapter images were found. Check the manifest selector and assetHosts.");
      return { chapterId, pages };
    },
  };
  return adapter;
}
