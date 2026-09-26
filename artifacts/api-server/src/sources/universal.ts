import type {
  ChapterListResponse,
  DetailOptions,
  ListOptions,
  MangaDetail,
  MangaListResponse,
  MangaSource,
  MangaSummary,
  PageListResponse,
} from "./types";

export const UNIVERSAL_SOURCE_ID = "builtin.universal";
type SourceEntry = { sourceId: string; mangaId: string; title: string; thumbnail: string; mediaType?: "manga" | "anime" };
type UniversalGroup = { entries: SourceEntry[] };

function encodeTuple(parts: [string, string]): string {
  return `universal:${Buffer.from(JSON.stringify(parts), "utf8").toString("base64url")}`;
}
function decodeTuple(value: string): [string, string] {
  const encoded = value.startsWith("universal:") ? value.slice("universal:".length) : value;
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("Universal chapter ID is invalid");
  return [String(parsed[0]), String(parsed[1])];
}
function encodeGroup(group: UniversalGroup): string {
  return `universal-group:${Buffer.from(JSON.stringify(group), "utf8").toString("base64url")}`;
}
function decodeGroup(value: string): UniversalGroup {
  const encoded = value.startsWith("universal-group:") ? value.slice("universal-group:".length) : value;
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as UniversalGroup;
  if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) throw new Error("Universal series ID is invalid");
  return parsed;
}
function normalizedTitle(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(chapter|chapters|vol|volume|season|part)\b/g, " ").replace(/\s+/g, " ").trim();
}
function groupKey(item: MangaSummary): string {
  return normalizedTitle(item.title);
}
function isAnime(item: MangaSummary): boolean {
  return item.mediaType === "anime" || /anime/i.test(item.type);
}

/** Universal is a virtual source: it discovers titles across working sources,
 * groups matching series into one card, and routes every selected item back to
 * its original source. */
export function createUniversalSource(getSources: () => MangaSource[]): MangaSource {
  const workingSources = () => getSources().filter(source => source.id !== UNIVERSAL_SOURCE_ID && ![
    "en.comix", "en.comickfan", "en.utoon", "en.manhuaplus", "en.elftoon", "en.allmanga",
  ].includes(source.id));

  async function aggregate(loader: (source: MangaSource) => Promise<MangaListResponse>, opts: ListOptions): Promise<MangaListResponse> {
    const sources = workingSources();
    const results = await Promise.allSettled(sources.map(source => Promise.race([
      loader(source),
      new Promise<MangaListResponse>((_, reject) => setTimeout(() => reject(new Error("source timeout")), 20_000)),
    ])));
    const groups = new Map<string, UniversalGroup>();
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      for (const item of result.value.items) {
        if (!opts.nsfw && item.isNsfw) continue;
        if (opts.media === "anime" && !isAnime(item)) continue;
        if (opts.media === "manga" && isAnime(item)) continue;
        const key = groupKey(item);
        if (!key) continue;
        const entry: SourceEntry = { sourceId: sources[index].id, mangaId: item.id, title: item.title, thumbnail: item.thumbnail, mediaType: item.mediaType };
        const group = groups.get(key) ?? { entries: [] };
        if (!group.entries.some(existing => existing.sourceId === entry.sourceId && existing.mangaId === entry.mangaId)) group.entries.push(entry);
        groups.set(key, group);
      }
    });
    const items = Array.from(groups.values()).map(group => {
      // Source order is the popularity/priority order supplied by the working registry.
      // The first source title and cover are the representative card for the merged group.
      const representative = group.entries[0];
      return { id: encodeGroup(group), title: representative.title, thumbnail: representative.thumbnail, type: representative.mediaType === "anime" ? "Anime" : "Manga", isNsfw: false, mediaType: representative.mediaType } satisfies MangaSummary;
    });
    return { items, page: opts.page, hasNextPage: results.some(result => result.status === "fulfilled" && result.value.hasNextPage) };
  }

  return {
    id: UNIVERSAL_SOURCE_ID,
    name: "Universal",
    lang: "all",
    isNsfw: false,
    popular: opts => aggregate(source => source.popular(opts), opts),
    latest: opts => aggregate(source => source.latest(opts), opts),
    search: (query, opts) => aggregate(source => source.search(query, opts), opts),
    details: async (id, opts: DetailOptions): Promise<MangaDetail> => {
      const group = decodeGroup(id);
      const sources = workingSources();
      const entry = group.entries.find(item => sources.some(source => source.id === item.sourceId));
      if (!entry) throw new Error("Universal source is unavailable");
      const source = sources.find(item => item.id === entry.sourceId)!;
      const detail = await source.details(entry.mangaId, opts);
      return { ...detail, id: encodeGroup(group), title: detail.title || entry.title };
    },
    chapters: async (mangaId, dedupe): Promise<ChapterListResponse> => {
      const group = decodeGroup(mangaId);
      const sources = workingSources();
      const results = await Promise.allSettled(group.entries.map(async entry => {
        const source = sources.find(item => item.id === entry.sourceId);
        if (!source) throw new Error("source unavailable");
        const response = await source.chapters(entry.mangaId, dedupe);
        return { entry, source, chapters: response.items };
      }));
      const seen = new Set<string>();
      const items = results.flatMap(result => {
        if (result.status !== "fulfilled") return [];
        return result.value.chapters.map(chapter => {
          const lang = chapter.lang || result.value.source.lang || "all";
          const scanlator = chapter.scanlator || result.value.source.name;
          // Keep translations distinct. Only an exact duplicate from the same
          // source/language/scanlator is collapsed.
          const key = `${result.value.entry.sourceId}|${lang}|${scanlator}|${chapter.number}|${chapter.title}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return {
            ...chapter,
            id: encodeTuple([result.value.entry.sourceId, String(chapter.id)]),
            lang,
            scanlator,
          };
        }).filter(Boolean);
      });
      return { items: items as NonNullable<(typeof items)[number]>[] };
    },
    pages: async (chapterId): Promise<PageListResponse> => {
      const [sourceId, sourceChapterId] = decodeTuple(chapterId);
      const source = workingSources().find(item => item.id === sourceId);
      if (!source) throw new Error(`Universal source ${sourceId} is unavailable`);
      const response = await source.pages(sourceChapterId);
      return { ...response, chapterId, pages: response.pages };
    },
  };
}
