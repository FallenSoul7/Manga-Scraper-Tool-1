export type PosterQuality = "small" | "medium" | "large";

export interface ListOptions {
  page: number;
  nsfw: boolean;
  poster: PosterQuality;
  /** Tag IDs (source-specific, e.g. comix `term_id`s) to filter the listing by. */
  tagIds?: string[];
  /** Optional sort key passed through from the client (source-defined values). */
  sort?: string;
}

export interface PopularSortOption {
  value: string;
  label: string;
}

export interface SourceTag {
  /** Stable identifier the source understands (e.g. comix `term_id`). */
  id: string;
  /** Human-readable label, shown in the picker. */
  name: string;
  /** Group label so the picker can section things ("Genre", "Theme", "Demographic"). */
  group?: string;
  /** Optional usage hint for sorting. */
  count?: number;
}

export interface MangaSummary {
  id: string;
  title: string;
  thumbnail: string;
  type: string;
  isNsfw: boolean;
}

export interface MangaListResponse {
  items: MangaSummary[];
  page: number;
  hasNextPage: boolean;
}

export interface MangaDetail {
  id: string;
  title: string;
  author: string;
  artist: string;
  synopsis: string;
  altTitles: string[];
  status: string;
  type: string;
  isNsfw: boolean;
  rating: number;
  thumbnail: string;
  genres: string[];
  score: string;
  scorePosition: "top" | "bottom" | "none";
}

export interface DetailOptions {
  poster: PosterQuality;
  alt: boolean;
  score: "top" | "bottom" | "none";
}

export interface ChapterSummary {
  id: number | string;
  number: number;
  title: string;
  scanlator: string;
  date: number;
  votes?: number;
  isOfficial?: boolean;
}

export interface ChapterListResponse {
  items: ChapterSummary[];
}

export interface PageInfo {
  index: number;
  url: string;
}

export interface PageListResponse {
  chapterId: number | string;
  pages: PageInfo[];
}

export interface MangaSource {
  id: string;
  name: string;
  lang: string;
  isNsfw: boolean;

  popular(opts: ListOptions): Promise<MangaListResponse>;
  latest(opts: ListOptions): Promise<MangaListResponse>;
  search(query: string, opts: ListOptions): Promise<MangaListResponse>;
  details(id: string, opts: DetailOptions): Promise<MangaDetail>;
  chapters(mangaId: string, dedupe: boolean): Promise<ChapterListResponse>;
  pages(chapterId: string): Promise<PageListResponse>;

  /** Returns the tags the user can filter by on this source. Optional. */
  tags?(): Promise<SourceTag[]>;

  /** Extra sort options for the popular listing (e.g. Most Viewed, Most Fapped). */
  popularSorts?: PopularSortOption[];

  imageReferer?: string;
}
