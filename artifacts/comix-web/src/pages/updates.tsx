import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useStore, storeActions } from "@/lib/storage";
import { useSettings } from "@/hooks/use-settings";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getGetChaptersQueryOptions } from "@workspace/api-client-react";
import { proxyImage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const COLLAPSED_LIMIT = 6;

export default function UpdatesPage() {
  const library = useStore(s => s.library);
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const libraryItems = useMemo(() => Object.values(library), [library]);

  const queries = useQueries({
    queries: libraryItems.map((manga) => {
      const options = getGetChaptersQueryOptions(manga.id, { dedupe: settings.dedupeChapters });
      return {
        ...options,
        staleTime: 10 * 60 * 1000,
        enabled: true,
      };
    })
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all(queries.map((_, i) =>
      queryClient.invalidateQueries({ queryKey: getGetChaptersQueryOptions(libraryItems[i].id).queryKey })
    ));
    setIsRefreshing(false);
  };

  const handleMarkAllSeen = () => {
    queries.forEach((q, i) => {
      if (q.data) {
        storeActions.markChaptersSeen(libraryItems[i].id, q.data.items.length);
      }
    });
  };

  let updatesByManga: Array<{
    manga: typeof libraryItems[0],
    chapters: any[],
    latestDate: number
  }> = [];

  let isLoading = false;

  queries.forEach((q, i) => {
    if (q.isLoading) isLoading = true;
    if (q.data) {
      const manga = libraryItems[i];
      const chaptersNow = q.data.items.length;
      const seen = manga.lastChapterCountSeen || 0;
      
      if (chaptersNow > seen) {
        const newChapters = q.data.items.slice(0, chaptersNow - seen);
        if (newChapters.length > 0) {
          updatesByManga.push({
            manga,
            chapters: newChapters,
            latestDate: newChapters[0].date
          });
        }
      }
    }
  });

  updatesByManga.sort((a, b) => b.latestDate - a.latestDate);

  return (
    <main className="container mx-auto px-4 py-6 sm:py-8 max-w-4xl animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground mb-1 sm:mb-2">Updates</h1>
          <p className="text-sm sm:text-lg text-muted-foreground">New chapters from your library.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="default" size="sm" onClick={handleMarkAllSeen} disabled={updatesByManga.length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Mark all seen
          </Button>
        </div>
      </div>

      {isLoading && updatesByManga.length === 0 ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4 p-4 border rounded-xl bg-card animate-pulse">
              <div className="w-16 h-24 bg-muted rounded-md" />
              <div className="flex-1 space-y-4 py-1">
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-8 bg-muted rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : updatesByManga.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-4 border rounded-2xl bg-card/50">
          <Clock className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">All caught up</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            We'll let you know when there's something new for the series in your library.
          </p>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {updatesByManga.map(({ manga, chapters, latestDate }) => {
            const isExpanded = expanded[manga.id];
            const hidden = Math.max(0, chapters.length - COLLAPSED_LIMIT);
            const visibleChapters = isExpanded ? chapters : chapters.slice(0, COLLAPSED_LIMIT);

            return (
              <div key={manga.id} className="flex gap-3 sm:gap-4 p-3 sm:p-4 border rounded-xl bg-card hover:shadow-md transition-shadow">
                <Link href={`/manga/${manga.id}`} className="shrink-0 cursor-pointer">
                  <div className="w-14 sm:w-20 aspect-[2/3] rounded-md overflow-hidden bg-muted shadow-sm hover:opacity-80 transition-opacity">
                    <img 
                      src={proxyImage(manga.thumbnail)} 
                      alt={manga.title} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                </Link>
                
                <div className="flex-1 min-w-0">
                  <Link href={`/manga/${manga.id}`}>
                    <h3 className="font-serif font-semibold text-base sm:text-lg mb-1 line-clamp-2 sm:truncate hover:text-primary transition-colors cursor-pointer">
                      {manga.title}
                    </h3>
                  </Link>
                  <div className="text-xs text-muted-foreground mb-2 sm:mb-3">
                    {chapters.length} new {chapters.length === 1 ? "chapter" : "chapters"} · Updated {formatDistanceToNow(latestDate * 1000, { addSuffix: true })}
                  </div>
                  
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {visibleChapters.map(ch => (
                      <Link key={ch.id} href={`/reader/${ch.id}?mangaId=${manga.id}`}>
                        <span className="inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md bg-primary/10 text-primary text-xs sm:text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer">
                          Ch. {ch.number}
                        </span>
                      </Link>
                    ))}

                    {hidden > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 sm:h-8 px-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground"
                        onClick={() => setExpanded(s => ({ ...s, [manga.id]: !isExpanded }))}
                      >
                        {isExpanded ? (
                          <>Show less <ChevronUp className="h-3 w-3 ml-1" /></>
                        ) : (
                          <>+{hidden} more <ChevronDown className="h-3 w-3 ml-1" /></>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
