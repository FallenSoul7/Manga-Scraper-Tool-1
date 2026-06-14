import { useQueries } from '@tanstack/react-query';
import { useStore } from '@/lib/storage';
import { getGetChaptersQueryOptions } from '@workspace/api-client-react';
import { useSettings } from '@/hooks/use-settings';

export function useUpdatesCount() {
  const library = useStore(s => s.library);
  const { settings } = useSettings();

  const libraryItems = Object.values(library);

  const queries = useQueries({
    queries: libraryItems.map((manga) => {
      const options = getGetChaptersQueryOptions(manga.id, { dedupe: settings.dedupeChapters });
      return {
        ...options,
        staleTime: 10 * 60 * 1000, // 10 mins
        enabled: true,
      };
    })
  });

  let totalNew = 0;
  let isLoading = false;

  queries.forEach((q, index) => {
    if (q.isLoading) isLoading = true;
    if (q.data) {
      const manga = libraryItems[index];
      const chaptersNow = q.data.items.length;
      const seen = manga.lastChapterCountSeen || 0;
      if (chaptersNow > seen) {
        totalNew += (chaptersNow - seen);
      }
    }
  });

  return { totalNew, isLoading };
}
