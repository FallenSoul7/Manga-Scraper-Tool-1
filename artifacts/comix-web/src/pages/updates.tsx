import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useStore, storeActions } from "@/lib/storage";
import { useQueryClient } from "@tanstack/react-query";
import { getGetChaptersQueryOptions } from "@workspace/api-client-react";
import { proxyImage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, Clock, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const COLLAPSED_LIMIT = 6;

export default function UpdatesPage() {
  const library = useStore(s => s.library);
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const libraryItems = useMemo(() => Object.values(library), [library]);

  const updatesByManga = useMemo(() => {
    return libraryItems
      .filter(m => (m.pendingUpdates ?? []).length > 0)
      .map(m => {
        const chapters = [...(m.pendingUpdates ?? [])].sort((a, b) => b.number - a.number);
        return { manga: m, chapters, latestDate: chapters[0]?.date ?? 0 };
      })
      .sort((a, b) => b.latestDate - a.latestDate);
  }, [library]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all(
        libraryItems.map(async (manga) => {
          const opts = getGetChaptersQueryOptions(manga.id, { dedupe: false });
          const data = await queryClient.fetchQuery({ ...opts, staleTime: 0 }) as any;
          if (!data?.items) return;
          const total: number = data.items.length;
          const seen: number = manga.lastChapterCountSeen ?? 0;
          if (total > seen) {
            const fresh = data.items.slice(0, total - seen);
            const newChaps = fresh.map((ch: any) => ({
              id: ch.id as number,
              number: ch.number as number,
              title: (ch.title as string) ?? "",
              date: ch.date as number,
            }));
            storeActions.recordDiscoveredUpdates(manga.id, newChaps, total);
          }
        })
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <main className="container mx-auto px-4 pt-3 pb-8 max-w-4xl animate-in fade-in duration-500">
      {/* Action bar */}
      <div className="flex items-center justify-end gap-2 mb-5">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Checking…" : "Check all"}
        </Button>
        <Button variant="default" size="sm" onClick={storeActions.clearAllPendingUpdates} disabled={updatesByManga.length === 0}>
          <CheckCircle2 className="h-4 w-4 mr-2" />
          Mark all seen
        </Button>
      </div>

      {isRefreshing && updatesByManga.length === 0 ? (
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
            Open a title in your library and we'll flag any new chapters here. Or hit "Check all" to scan everything at once.
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
                    <img src={proxyImage(manga.thumbnail)} alt={manga.title} className="w-full h-full object-cover" />
                  </div>
                </Link>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Link href={`/manga/${manga.id}`}>
                      <h3 className="font-serif font-semibold text-base sm:text-lg line-clamp-2 sm:truncate hover:text-primary transition-colors cursor-pointer">
                        {manga.title}
                      </h3>
                    </Link>
                    <button
                      title="Mark as seen"
                      onClick={() => storeActions.clearPendingUpdates(manga.id)}
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2 sm:mb-3">
                    {chapters.length} new {chapters.length === 1 ? "chapter" : "chapters"}
                    {latestDate > 0 && <> · Updated {formatDistanceToNow(latestDate * 1000, { addSuffix: true })}</>}
                  </div>

                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {visibleChapters.map(ch => (
                      <Link key={ch.id} href={`/reader/${ch.id}?mangaId=${manga.id}`}>
                        <span className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md bg-primary/10 text-primary text-xs sm:text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer">
                          <Sparkles className="h-2.5 w-2.5" />
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
                        {isExpanded
                          ? <><ChevronUp className="h-3 w-3 mr-1" />Show less</>
                          : <>+{hidden} more<ChevronDown className="h-3 w-3 ml-1" /></>}
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
