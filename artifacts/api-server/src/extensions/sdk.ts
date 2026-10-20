import type {
  ChapterListResponse,
  DetailOptions,
  ListOptions,
  MangaDetail,
  MangaListResponse,
  MangaSource,
  PageListResponse,
  SourceRequestPolicy,
  SourceTag,
} from "../sources/types";

/**
 * ComiHub's source-extension contract.
 *
 * This is intentionally an adapter contract, not a port of MangaYomi's
 * Flutter evaluator. Extensions are normalized at this boundary and the rest
 * of ComiHub only deals with the stable MangaSource interface.
 */
export const COMIHUB_EXTENSION_API = 1 as const;

export type ExtensionMediaType = "manga" | "anime" | "novel";
export type ExtensionFilterKind = "search" | "select" | "multi-select" | "tri-state";

export interface ExtensionFilterDefinition {
  id: string;
  label: string;
  kind: ExtensionFilterKind;
  queryKey: string;
  options?: Array<{ value: string; label: string }>;
}

export interface ExtensionManifest {
  api: typeof COMIHUB_EXTENSION_API;
  id: string;
  name: string;
  version: string;
  languages: string[];
  baseUrl?: string;
  icon?: string;
  adult: boolean;
  mediaTypes: ExtensionMediaType[];
  adapter: "api" | "html" | "graphql" | "anime" | "novel" | "media";
  capabilities: {
    popular: boolean;
    latest: boolean;
    search: boolean;
    details: boolean;
    chapters: boolean;
    pages: boolean;
    videos: boolean;
    pagination: boolean;
    requestHeaders: boolean;
    referer: boolean;
  };
  filters: ExtensionFilterDefinition[];
}

export interface ExtensionRequestContext {
  page: number;
  signal?: AbortSignal;
  request?: SourceRequestPolicy;
}

export interface ExtensionAdapter {
  readonly manifest: ExtensionManifest;
  popular(context: ExtensionRequestContext): Promise<MangaListResponse>;
  latest(context: ExtensionRequestContext): Promise<MangaListResponse>;
  search(query: string, context: ExtensionRequestContext): Promise<MangaListResponse>;
  details(id: string, options: DetailOptions): Promise<MangaDetail>;
  chapters(id: string, dedupe: boolean): Promise<ChapterListResponse>;
  pages(chapterId: string): Promise<PageListResponse>;
  tags?(): Promise<SourceTag[]>;
}

/** Convert the ComiHub adapter contract into the application source contract. */
export function asMangaSource(adapter: ExtensionAdapter): MangaSource {
  const { manifest } = adapter;
  return {
    id: manifest.id,
    name: manifest.name,
    lang: manifest.languages.length === 1 ? manifest.languages[0] : "all",
    isNsfw: manifest.adult,
    popular: options => adapter.popular({ page: options.page, request: { headers: {}, referer: manifest.baseUrl } }),
    latest: options => adapter.latest({ page: options.page, request: { headers: {}, referer: manifest.baseUrl } }),
    search: (query, options) => adapter.search(query, { page: options.page, request: { headers: {}, referer: manifest.baseUrl } }),
    details: (id, options) => adapter.details(id, options),
    chapters: (id, dedupe) => adapter.chapters(id, dedupe),
    pages: chapterId => adapter.pages(chapterId),
    tags: adapter.tags,
    imageReferer: manifest.baseUrl,
    requestPolicy: manifest.baseUrl ? { referer: manifest.baseUrl } : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate install metadata before it enters the extension catalog. */
export function parseExtensionManifest(input: unknown): ExtensionManifest {
  if (!isRecord(input)) throw new Error("Extension manifest must be an object");
  const requiredStrings = ["id", "name", "version", "adapter"];
  for (const key of requiredStrings) {
    if (typeof input[key] !== "string" || !String(input[key]).trim()) {
      throw new Error(`Extension manifest field '${key}' is required`);
    }
  }
  if (input.api !== COMIHUB_EXTENSION_API) throw new Error(`Unsupported ComiHub extension API: ${String(input.api)}`);
  const languages = Array.isArray(input.languages) ? input.languages.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  if (!languages.length) throw new Error("Extension manifest must declare at least one language");
  const capabilities = isRecord(input.capabilities) ? input.capabilities : {};
  const filters = Array.isArray(input.filters) ? input.filters : [];
  return {
    api: COMIHUB_EXTENSION_API,
    id: String(input.id).trim(),
    name: String(input.name).trim(),
    version: String(input.version).trim(),
    languages: [...new Set(languages.map(language => language.trim().toLowerCase()))],
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : undefined,
    icon: typeof input.icon === "string" ? input.icon : undefined,
    adult: input.adult === true,
    mediaTypes: Array.isArray(input.mediaTypes) ? input.mediaTypes.filter((value): value is ExtensionMediaType => value === "manga" || value === "anime" || value === "novel") : ["manga"],
    adapter: input.adapter as ExtensionManifest["adapter"],
    capabilities: {
      popular: capabilities.popular === true,
      latest: capabilities.latest === true,
      search: capabilities.search === true,
      details: capabilities.details === true,
      chapters: capabilities.chapters === true,
      pages: capabilities.pages === true,
      videos: capabilities.videos === true,
      pagination: capabilities.pagination === true,
      requestHeaders: capabilities.requestHeaders === true,
      referer: capabilities.referer === true,
    },
    filters: filters.filter(isRecord).map(filter => ({
      id: String(filter.id ?? ""),
      label: String(filter.label ?? filter.id ?? ""),
      kind: (filter.kind ?? "select") as ExtensionFilterKind,
      queryKey: String(filter.queryKey ?? filter.id ?? ""),
      options: Array.isArray(filter.options) ? filter.options.filter(isRecord).map(option => ({ value: String(option.value ?? ""), label: String(option.label ?? option.value ?? "") })) : undefined,
    })).filter(filter => filter.id && filter.queryKey),
  };
}
