import type {
  ChapterListResponse,
  DetailOptions,
  ListOptions,
  MangaDetail,
  MangaListResponse,
  MangaSource,
  PageListResponse,
} from "./types";

export const UNIVERSAL_SOURCE_ID = "builtin.universal";

function encode(parts: [string, string]): string {
  return `universal:${Buffer.from(JSON.stringify(parts), "utf8").toString("base64url")}`;
}
function decode(value: string): [string, string] {
  const encoded = value.startsWith("universal:") ? value.slice("universal:".length) : value;
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("Universal ID is invalid");
  return [String(parsed[0]), String(parsed[1])];
}

/**
 * Universal is deliberately a router rather than a scraper. It combines the
 * implemented sources for discovery, then delegates detail/chapter/page calls
 * back to the original source encoded in each item ID.
 */
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
    const acceptsMedia = (item: MangaListResponse["items"][number]) => {
      if (opts.media === "anime") return item.mediaType === "anime" || /anime/i.test(item.type);
      if (opts.media === "manga") return item.mediaType !== "anime" && !/anime/i.test(item.type);
      return true;
    };
    // The source adapter's IDs are not guaranteed globally unique. Encode the
    // owner source so every Universal card can be opened and read correctly.
    const owned = results.flatMap((result, index) => result.status === "fulfilled"
      ? result.value.items.filter(item => (opts.nsfw || !item.isNsfw) && acceptsMedia(item)).map(item => ({ ...item, id: encode([sources[index].id, item.id]) }))
      : []);
    const seen = new Set<string>();
    const unique = owned.filter(item => !seen.has(item.id) && seen.add(item.id));
    return { items: unique, page: opts.page, hasNextPage: results.some(result => result.status === "fulfilled" && result.value.hasNextPage) };
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
      const [sourceId, sourceItemId] = decode(id);
      const source = workingSources().find(item => item.id === sourceId);
      if (!source) throw new Error(`Universal source ${sourceId} is unavailable`);
      const detail = await source.details(sourceItemId, opts);
      return { ...detail, id: encode([sourceId, detail.id]) };
    },
    chapters: async (mangaId, dedupe): Promise<ChapterListResponse> => {
      const [sourceId, sourceItemId] = decode(mangaId);
      const source = workingSources().find(item => item.id === sourceId);
      if (!source) throw new Error(`Universal source ${sourceId} is unavailable`);
      const response = await source.chapters(sourceItemId, dedupe);
      return { items: response.items.map(chapter => ({ ...chapter, id: encode([sourceId, String(chapter.id)]) })) };
    },
    pages: async (chapterId): Promise<PageListResponse> => {
      const [sourceId, sourceChapterId] = decode(chapterId);
      const source = workingSources().find(item => item.id === sourceId);
      if (!source) throw new Error(`Universal source ${sourceId} is unavailable`);
      const response = await source.pages(sourceChapterId);
      return { ...response, chapterId, pages: response.pages };
    },
  };
}
