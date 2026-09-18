import { useQueries } from '@tanstack/react-query';
import { useStore } from '@/lib/storage';
import { checkMangaUpdates } from '@/lib/update-checker';

export function useUpdatesCount() {
  const library = useStore(s => s.library);
  const tracked = Object.values(library).filter(manga => manga.updatesEnabled);

  const queries = useQueries({
    queries: tracked.map((manga) => ({
      queryKey: ['tracked-updates', manga.id, manga.sourceId, manga.trackedChapterIds],
      queryFn: () => checkMangaUpdates(manga),
      staleTime: 5 * 60 * 1000,
      enabled: true,
    })),
  });

  let totalNew = 0;
  let isLoading = false;
  queries.forEach(query => {
    if (query.isLoading) isLoading = true;
    if (query.data?.newChapters) totalNew += query.data.newChapters.length;
  });
  return { totalNew, isLoading };
}
