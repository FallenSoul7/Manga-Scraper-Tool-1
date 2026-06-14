export * from "./generated/api";

export type {
  Chapter,
  ChapterList,
  GetChaptersParams as GetChaptersParamsType,
  GetLatestParams,
  GetMangaDetailsParams as GetMangaDetailsParamsType,
  GetPopularParams,
  HealthStatus,
  MangaDetail,
  MangaListResponse,
  MangaSummary,
  PageList,
  PageListPagesItem,
  SearchMangaParams,
} from "./generated/types";

export {
  GetLatestPoster,
  GetMangaDetailsPoster,
  GetMangaDetailsScore,
  GetPopularPoster,
  SearchMangaPoster,
} from "./generated/types";
