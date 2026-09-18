import { customFetch } from "@workspace/api-client-react";
import type { SavedManga, PendingChapter } from "@/lib/storage";

export interface ChapterLike {
  id: string | number;
  number: number;
  title?: string;
  date?: number;
}

export interface UpdateCheckResult {
  mangaId: string;
  chapters: ChapterLike[];
  newChapters: PendingChapter[];
  chapterIds: string[];
  initialized: boolean;
  error?: string;
}

export function chapterId(chapter: ChapterLike): string {
  return String(chapter.id);
}

export async function fetchMangaChapters(manga: SavedManga): Promise<ChapterLike[]> {
  const headers = manga.sourceId ? { "X-Source": manga.sourceId } : undefined;
  const response = await customFetch<{ items?: ChapterLike[] }>(
    `/api/manga/${encodeURIComponent(manga.id)}/chapters?dedupe=false`,
    { headers },
  );
  return Array.isArray(response.items) ? response.items : [];
}

export async function checkMangaUpdates(manga: SavedManga): Promise<UpdateCheckResult> {
  const chapters = await fetchMangaChapters(manga);
  const ids = chapters.map(chapterId);
  if (!manga.updatesInitialized) {
    return { mangaId: manga.id, chapters, newChapters: [], chapterIds: ids, initialized: false };
  }
  const known = new Set(manga.trackedChapterIds ?? []);
  const newChapters = chapters
    .filter(chapter => !known.has(chapterId(chapter)))
    .map(chapter => ({
      id: chapter.id,
      number: Number(chapter.number) || 0,
      title: chapter.title ?? "",
      date: Number(chapter.date) || 0,
    }));
  return { mangaId: manga.id, chapters, newChapters, chapterIds: ids, initialized: true };
}
