import { useQuery, type UseQueryOptions, type QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface MangaSummary {
  id: string;
  title: string;
  thumbnail: string;
  type?: string;
  isNsfw?: boolean;
}

export interface Chapter {
  id: number | string;
  number: number;
  title?: string;
  date?: number;
  scanlatorId?: string | number;
  isOfficial?: boolean;
  votes?: number;
}

export interface ChapterPage {
  index: number;
  url: string;
}

export interface MangaDetails {
  id: string;
  title: string;
  altTitles?: string[];
  thumbnail: string;
  description?: string;
  status?: string;
  author?: string;
  artist?: string;
  genres?: string[];
  score?: string;
  isNsfw?: boolean;
  type?: string;
}

export interface ChaptersResponse {
  items: Chapter[];
}

export interface PagesResponse {
  pages: ChapterPage[];
  items?: ChapterPage[];
}

export interface SearchResponse {
  items: MangaSummary[];
}

// ── Enums ────────────────────────────────────────────────────────────────────

export enum GetPopularPoster {
  small = "small",
  medium = "medium",
  large = "large",
}

export enum GetMangaDetailsScore {
  top = "top",
  bottom = "bottom",
  hidden = "hidden",
}

// ── Manga Details ─────────────────────────────────────────────────────────────

export interface GetMangaDetailsParams {
  poster?: string;
  alt?: boolean;
  score?: string;
}

export function getGetMangaDetailsQueryKey(id: string, params?: GetMangaDetailsParams): QueryKey {
  return ["manga", id, "details", params ?? {}];
}

export function useGetMangaDetails(
  id: string,
  params?: GetMangaDetailsParams,
  options?: { query?: Partial<UseQueryOptions<MangaDetails>> },
) {
  const qs = params ? "?" + new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)])
  ).toString() : "";
  return useQuery<MangaDetails>({
    queryKey: getGetMangaDetailsQueryKey(id, params),
    queryFn: () => customFetch<MangaDetails>(`/api/manga/${encodeURIComponent(id)}${qs}`),
    enabled: !!id,
    ...options?.query,
  });
}

// ── Chapters ──────────────────────────────────────────────────────────────────

export interface GetChaptersParams {
  dedupe?: boolean;
}

export function getGetChaptersQueryKey(id: string, params?: GetChaptersParams): QueryKey {
  return ["manga", id, "chapters", params ?? {}];
}

export function getGetChaptersQueryOptions(id: string, params?: GetChaptersParams) {
  const qs = params?.dedupe !== undefined ? `?dedupe=${params.dedupe}` : "";
  return {
    queryKey: getGetChaptersQueryKey(id, params),
    queryFn: () => customFetch<ChaptersResponse>(`/api/manga/${encodeURIComponent(id)}/chapters${qs}`),
    enabled: !!id,
  };
}

export function useGetChapters(
  id: string,
  params?: GetChaptersParams,
  options?: { query?: Partial<UseQueryOptions<ChaptersResponse>> },
) {
  return useQuery<ChaptersResponse>({
    ...getGetChaptersQueryOptions(id, params),
    ...options?.query,
  });
}

// ── Chapter Pages ─────────────────────────────────────────────────────────────

export function getGetChapterPagesQueryKey(chapterId: string): QueryKey {
  return ["chapter", chapterId, "pages"];
}

export function useGetChapterPages(
  chapterId: string,
  options?: { query?: Partial<UseQueryOptions<PagesResponse>> },
) {
  return useQuery<PagesResponse>({
    queryKey: getGetChapterPagesQueryKey(chapterId),
    queryFn: () => customFetch<PagesResponse>(`/api/chapter/${encodeURIComponent(chapterId)}/pages`),
    enabled: !!chapterId && chapterId !== "0",
    ...options?.query,
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchMangaParams {
  query: string;
  nsfw?: boolean;
  poster?: string;
  page?: number;
}

export function getSearchMangaQueryKey(params: SearchMangaParams): QueryKey {
  return ["search", params];
}

export function useSearchManga(
  params: SearchMangaParams,
  options?: { query?: Partial<UseQueryOptions<SearchResponse>> },
) {
  const qs = "?" + new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)])
  ).toString();
  return useQuery<SearchResponse>({
    queryKey: getSearchMangaQueryKey(params),
    queryFn: () => customFetch<SearchResponse>(`/api/search${qs}`),
    enabled: (params.query?.length ?? 0) >= 2,
    ...options?.query,
  });
}
