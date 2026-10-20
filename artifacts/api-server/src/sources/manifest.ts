import type { MangaSource, PopularSortOption } from "./types";

export type SourceAdapterFamily =
  | "builtin"
  | "mangadex-api"
  | "madara"
  | "manga-themesia"
  | "graphql"
  | "anime"
  | "novel"
  | "media"
  | "html"
  | "unknown";

export type SourceFilterType = "search" | "select" | "multi-select" | "tri-state";

export interface SourceFilterManifest {
  id: string;
  label: string;
  type: SourceFilterType;
  /** Values are populated for select-like filters when the source exposes them. */
  options?: Array<{ value: string; label: string }>;
  /** Query field consumed by the source adapter. */
  queryKey?: string;
}

export interface SourceManifest {
  id: string;
  name: string;
  slug: string;
  version: number;
  lang: string;
  /** Explicit language list used by language-aware extensions. */
  languages: string[];
  languageAware: boolean;
  isNsfw: boolean;
  adapter: SourceAdapterFamily;
  capabilities: {
    search: boolean;
    popular: boolean;
    latest: boolean;
    detail: boolean;
    chapters: boolean;
    pages: boolean;
    tags: boolean;
    pagination: boolean;
    mediaTypes: Array<"manga" | "anime" | "novel">;
  };
  filters: SourceFilterManifest[];
}

const LANGUAGE_ALIASES: Record<string, string[]> = {
  all: ["all"],
  en: ["en"],
  es: ["es"],
  fr: ["fr"],
  de: ["de"],
  ja: ["ja"],
  ko: ["ko"],
  pt: ["pt"],
  zh: ["zh"],
};

function adapterFamily(source: MangaSource): SourceAdapterFamily {
  if (source.id === "builtin.universal") return "builtin";
  if (source.id === "all.mangadex") return "mangadex-api";
  if (source.id === "en.allmanga" || source.id === "en.allanime") return "graphql";
  if (source.id === "en.animegg") return "anime";
  if (source.id === "all.atsu" || source.id.includes("novel")) return "novel";
  if (["en.madara", "en.manhuaplus", "en.utoon"].includes(source.id)) return "madara";
  if (source.id.includes("thunderscans") || source.id.includes("themesia") || source.id.includes("ravenscans")) return "manga-themesia";
  if (source.id.includes("pawchive") || source.id.includes("rule34") || source.id.includes("hentaiyoga")) return "media";
  return "html";
}

function mediaTypes(source: MangaSource): Array<"manga" | "anime" | "novel"> {
  if (source.id === "en.animegg") return ["anime"];
  if (source.id === "en.allmanga" || source.id === "en.allanime") return ["manga", "anime"];
  if (source.id.includes("novel")) return ["novel"];
  return ["manga"];
}

function filtersFor(source: MangaSource): SourceFilterManifest[] {
  const filters: SourceFilterManifest[] = [
    { id: "query", label: "Search", type: "search", queryKey: "query" },
  ];
  if (source.tags) {
    filters.push({ id: "tags", label: "Tags", type: "tri-state", queryKey: "tagIds[]" });
  }
  if (source.popularSorts?.length) {
    filters.push({
      id: "sort",
      label: "Sort",
      type: "select",
      queryKey: "sort",
      options: source.popularSorts.map((option: PopularSortOption) => ({ ...option })),
    });
  }
  if (source.id === "en.allmanga" || source.id === "en.allanime") {
    filters.push({
      id: "media",
      label: "Media type",
      type: "select",
      queryKey: "media",
      options: [
        { value: "all", label: "All" },
        { value: "manga", label: "Manga" },
        { value: "anime", label: "Anime" },
      ],
    });
  }
  return filters;
}

export function createSourceManifest(
  source: MangaSource,
  catalog?: { slug?: string; versionCode?: number; isNsfw?: boolean },
): SourceManifest {
  const lang = source.lang || "all";
  return {
    id: source.id,
    name: source.name,
    slug: catalog?.slug ?? source.id,
    version: catalog?.versionCode ?? 1,
    lang,
    languages: LANGUAGE_ALIASES[lang] ?? [lang],
    languageAware: lang === "all" || source.id === "all.mangadex",
    isNsfw: catalog?.isNsfw ?? source.isNsfw,
    adapter: adapterFamily(source),
    capabilities: {
      search: Boolean(source.search),
      popular: Boolean(source.popular),
      latest: Boolean(source.latest),
      detail: Boolean(source.details),
      chapters: Boolean(source.chapters),
      pages: Boolean(source.pages),
      tags: Boolean(source.tags),
      pagination: true,
      mediaTypes: mediaTypes(source),
    },
    filters: filtersFor(source),
  };
}
