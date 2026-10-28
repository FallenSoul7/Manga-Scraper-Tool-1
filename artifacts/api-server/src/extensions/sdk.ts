import type {
  ChapterListResponse,
  DetailOptions,
  ListOptions,
  MangaDetail,
  MangaListResponse,
  MangaSource,
  PageListResponse,
  PosterQuality,
  SourceRequestPolicy,
  SourceMediaType,
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
export type ExtensionAdapterKind = "api" | "html" | "graphql" | "anime" | "novel" | "media";
export type ExtensionCapability =
  | "popular"
  | "latest"
  | "search"
  | "details"
  | "chapters"
  | "pages"
  | "tags";

export interface ExtensionCapabilities {
  popular: boolean;
  latest: boolean;
  search: boolean;
  details: boolean;
  chapters: boolean;
  pages: boolean;
  tags: boolean;
  videos: boolean;
  pagination: boolean;
  requestHeaders: boolean;
  referer: boolean;
  rangeRequests: boolean;
}

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
  adapter: ExtensionAdapterKind;
  capabilities: ExtensionCapabilities;
  filters: ExtensionFilterDefinition[];
}

export interface ExtensionRequestContext {
  page?: number;
  nsfw?: boolean;
  poster?: PosterQuality;
  media?: ListOptions["media"];
  tagIds?: string[];
  sort?: string;
  signal?: AbortSignal;
  request?: SourceRequestPolicy;
}

export interface ExtensionAdapter {
  readonly manifest: ExtensionManifest;
  popular?(context: ExtensionRequestContext): Promise<MangaListResponse>;
  latest?(context: ExtensionRequestContext): Promise<MangaListResponse>;
  search?(query: string, context: ExtensionRequestContext): Promise<MangaListResponse>;
  details?(id: string, options: DetailOptions, context?: ExtensionRequestContext): Promise<MangaDetail>;
  chapters?(id: string, dedupe: boolean, context?: ExtensionRequestContext): Promise<ChapterListResponse>;
  pages?(chapterId: string, context?: ExtensionRequestContext): Promise<PageListResponse>;
  tags?(): Promise<SourceTag[]>;
}

const ADAPTER_KINDS = new Set<ExtensionAdapterKind>(["api", "html", "graphql", "anime", "novel", "media"]);
const MEDIA_TYPES = new Set<ExtensionMediaType>(["manga", "anime", "novel"]);
const FILTER_KINDS = new Set<ExtensionFilterKind>(["search", "select", "multi-select", "tri-state"]);
const BOOLEAN_CAPABILITIES: Array<keyof ExtensionCapabilities> = [
  "popular", "latest", "search", "details", "chapters", "pages", "tags",
  "videos", "pagination", "requestHeaders", "referer", "rangeRequests",
];
const REGISTRY_REQUIRED_CAPABILITIES: ExtensionCapability[] = [
  "popular", "latest", "search", "details", "chapters", "pages",
];

function validatePublicHttpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Extension manifest ${label} must be an absolute HTTPS URL`);
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.includes(":")
  ) {
    throw new Error(`Extension manifest ${label} must use a public HTTPS origin`);
  }
  return url.toString().replace(/\/$/, "");
}

function parseFilters(value: unknown): ExtensionFilterDefinition[] {
  if (!Array.isArray(value)) throw new Error("Extension manifest filters must be an array");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Extension manifest filter ${index} must be an object`);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const queryKey = typeof raw.queryKey === "string" ? raw.queryKey.trim() : "";
    if (!id || !label || !queryKey) {
      throw new Error(`Extension manifest filter ${index} requires id, label, and queryKey`);
    }
    if (seen.has(id)) throw new Error(`Extension manifest contains duplicate filter '${id}'`);
    seen.add(id);
    if (typeof raw.kind !== "string" || !FILTER_KINDS.has(raw.kind as ExtensionFilterKind)) {
      throw new Error(`Extension manifest filter '${id}' has an unsupported kind`);
    }
    let options: ExtensionFilterDefinition["options"];
    if (raw.options !== undefined) {
      if (!Array.isArray(raw.options)) throw new Error(`Extension manifest filter '${id}' options must be an array`);
      const optionValues = new Set<string>();
      options = raw.options.map((option, optionIndex) => {
        if (!isRecord(option)) throw new Error(`Extension manifest filter '${id}' option ${optionIndex} must be an object`);
        const optionValue = typeof option.value === "string" ? option.value.trim() : "";
        const optionLabel = typeof option.label === "string" ? option.label.trim() : "";
        if (!optionValue || !optionLabel || optionValues.has(optionValue)) {
          throw new Error(`Extension manifest filter '${id}' has an invalid or duplicate option`);
        }
        optionValues.add(optionValue);
        return { value: optionValue, label: optionLabel };
      });
    }
    const kind = raw.kind as ExtensionFilterKind;
    if ((kind === "select" || kind === "multi-select") && (!options || options.length === 0)) {
      throw new Error(`Extension manifest filter '${id}' requires options`);
    }
    return { id, label, kind, queryKey, options };
  });
}

function capabilityMethod(adapter: ExtensionAdapter, capability: ExtensionCapability): boolean {
  const methodName = capability === "details" ? "details" : capability;
  return typeof adapter[methodName] === "function";
}

function validateAdapterMethods(adapter: ExtensionAdapter, manifest: ExtensionManifest): void {
  const capabilities: ExtensionCapability[] = ["popular", "latest", "search", "details", "chapters", "pages", "tags"];
  for (const capability of capabilities) {
    if (manifest.capabilities[capability] !== capabilityMethod(adapter, capability)) {
      throw new Error(
        `Extension '${manifest.id}' capability '${capability}' does not match its adapter method`,
      );
    }
  }
}

export class UnsupportedExtensionCapabilityError extends Error {
  constructor(sourceId: string, capability: string) {
    super(`Extension '${sourceId}' does not support ${capability}`);
    this.name = "UnsupportedExtensionCapabilityError";
  }
}

function requireMethod<K extends ExtensionCapability>(
  adapter: ExtensionAdapter,
  manifest: ExtensionManifest,
  capability: K,
): NonNullable<ExtensionAdapter[K]> {
  const method = adapter[capability] as NonNullable<ExtensionAdapter[K]> | undefined;
  if (!method) throw new UnsupportedExtensionCapabilityError(manifest.id, capability);
  return method;
}

/** Convert the validated ComiHub adapter contract into the application source contract. */
export function asMangaSource(adapter: ExtensionAdapter): MangaSource {
  const manifest = parseExtensionManifest(adapter.manifest);
  validateAdapterMethods(adapter, manifest);
  const request = manifest.baseUrl ? { referer: `${manifest.baseUrl}/` } : undefined;
  const context = (options?: ListOptions): ExtensionRequestContext => ({
    ...(options ?? {}),
    request,
  });
  const filters = manifest.filters.map(filter => ({
    id: filter.id,
    label: filter.label,
    type: filter.kind,
    queryKey: filter.queryKey,
    options: filter.options,
  }));

  return {
    id: manifest.id,
    name: manifest.name,
    lang: manifest.languages.length === 1 ? manifest.languages[0] : "all",
    isNsfw: manifest.adult,
    popular: async options => requireMethod(adapter, manifest, "popular").call(adapter, context(options)),
    latest: async options => requireMethod(adapter, manifest, "latest").call(adapter, context(options)),
    search: async (query, options) =>
      requireMethod(adapter, manifest, "search").call(adapter, query, context(options)),
    details: async (id, options) =>
      requireMethod(adapter, manifest, "details").call(adapter, id, options, context()),
    chapters: async (id, dedupe) =>
      requireMethod(adapter, manifest, "chapters").call(adapter, id, dedupe, context()),
    pages: async chapterId => requireMethod(adapter, manifest, "pages").call(adapter, chapterId, context()),
    tags: manifest.capabilities.tags
      ? async () => requireMethod(adapter, manifest, "tags").call(adapter)
      : undefined,
    imageReferer: request?.referer,
    requestPolicy: request ? {
      referer: request.referer,
      supportsRange: manifest.capabilities.rangeRequests,
    } : undefined,
    manifestAdapter: manifest.adapter,
    manifestCapabilities: {
      search: manifest.capabilities.search,
      popular: manifest.capabilities.popular,
      latest: manifest.capabilities.latest,
      detail: manifest.capabilities.details,
      chapters: manifest.capabilities.chapters,
      pages: manifest.capabilities.pages,
      tags: manifest.capabilities.tags,
      pagination: manifest.capabilities.pagination,
      requestHeaders: manifest.capabilities.requestHeaders,
      referer: manifest.capabilities.referer,
      rangeRequests: manifest.capabilities.rangeRequests,
      mediaTypes: manifest.mediaTypes as SourceMediaType[],
    },
    manifestFilters: filters,
  };
}

/** Register a reviewed, build-time adapter without allowing it to replace a handler. */
export function registerExtensionAdapter(
  registry: Map<string, MangaSource>,
  adapter: ExtensionAdapter,
): MangaSource {
  const source = asMangaSource(adapter);
  const missingCapability = REGISTRY_REQUIRED_CAPABILITIES.find(
    capability => !source.manifestCapabilities?.[capability === "details" ? "detail" : capability],
  );
  if (missingCapability) {
    throw new Error(
      `Cannot register extension '${source.id}': required source capability '${missingCapability}' is not implemented`,
    );
  }
  if (registry.has(source.id)) {
    throw new Error(`Cannot register extension '${source.id}': a source with that ID already exists`);
  }
  registry.set(source.id, source);
  return source;
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
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(String(input.id))) {
    throw new Error("Extension manifest ID has an invalid format");
  }
  const languages = Array.isArray(input.languages)
    ? input.languages.map(value => {
        if (typeof value !== "string" || !value.trim()) {
          throw new Error("Extension manifest languages must contain non-empty strings");
        }
        return value.trim().toLowerCase();
      })
    : [];
  if (!languages.length) throw new Error("Extension manifest must declare at least one language");
  if (typeof input.adapter !== "string" || !ADAPTER_KINDS.has(input.adapter as ExtensionAdapterKind)) {
    throw new Error(`Extension manifest adapter '${String(input.adapter)}' is unsupported`);
  }
  const capabilities = isRecord(input.capabilities) ? input.capabilities : null;
  if (!capabilities) throw new Error("Extension manifest capabilities must be an object");
  for (const key of BOOLEAN_CAPABILITIES) {
    if (typeof capabilities[key] !== "boolean") {
      throw new Error(`Extension manifest capability '${key}' must be a boolean`);
    }
  }
  if (capabilities.videos && !capabilities.pages) {
    throw new Error("Extension manifest video capability requires pages");
  }
  if (capabilities.pagination && !capabilities.popular && !capabilities.latest && !capabilities.search) {
    throw new Error("Extension manifest pagination requires a paginated listing capability");
  }
  const mediaTypes = input.mediaTypes;
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) {
    throw new Error("Extension manifest must declare at least one media type");
  }
  const parsedMediaTypes = mediaTypes.map(value => {
    if (typeof value !== "string" || !MEDIA_TYPES.has(value as ExtensionMediaType)) {
      throw new Error(`Extension manifest media type '${String(value)}' is unsupported`);
    }
    return value as ExtensionMediaType;
  });
  if (new Set(parsedMediaTypes).size !== parsedMediaTypes.length) {
    throw new Error("Extension manifest media types must be unique");
  }
  const filters = parseFilters(input.filters);
  if (filters.some(filter => filter.kind === "search") && !capabilities.search) {
    throw new Error("Extension manifest search filters require search capability");
  }
  const baseUrl = input.baseUrl === undefined
    ? undefined
    : typeof input.baseUrl === "string"
      ? validatePublicHttpsUrl(input.baseUrl, "baseUrl")
      : (() => { throw new Error("Extension manifest baseUrl must be a string"); })();
  const icon = input.icon === undefined
    ? undefined
    : typeof input.icon === "string" && input.icon.startsWith("/") && !input.icon.startsWith("//")
      ? input.icon
      : typeof input.icon === "string"
        ? validatePublicHttpsUrl(input.icon, "icon")
        : (() => { throw new Error("Extension manifest icon must be a string"); })();
  return {
    api: COMIHUB_EXTENSION_API,
    id: String(input.id).trim(),
    name: String(input.name).trim(),
    version: String(input.version).trim(),
    languages: [...new Set(languages.map(language => language.trim().toLowerCase()))],
    baseUrl,
    icon,
    adult: input.adult === true,
    mediaTypes: parsedMediaTypes,
    adapter: input.adapter as ExtensionManifest["adapter"],
    capabilities: {
      popular: capabilities.popular as boolean,
      latest: capabilities.latest as boolean,
      search: capabilities.search as boolean,
      details: capabilities.details as boolean,
      chapters: capabilities.chapters as boolean,
      pages: capabilities.pages as boolean,
      tags: capabilities.tags as boolean,
      videos: capabilities.videos as boolean,
      pagination: capabilities.pagination as boolean,
      requestHeaders: capabilities.requestHeaders as boolean,
      referer: capabilities.referer as boolean,
      rangeRequests: capabilities.rangeRequests as boolean,
    },
    filters,
  };
}
