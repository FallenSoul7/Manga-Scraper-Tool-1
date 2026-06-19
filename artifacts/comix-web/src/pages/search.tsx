import { useSearch, useLocation } from "wouter";
import { useSearchManga, getSearchMangaQueryKey } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { MangaCard } from "@/components/manga-card";
import { Loader2, Search as SearchIcon, Clock, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "@/components/ui/button";

export default function SearchPage() {
  const searchString = useSearch();
  const query = useMemo(() => new URLSearchParams(searchString).get("query") || "", [searchString]);
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const searchHistory = useStore(s => s.searchHistory);
  const [page, setPage] = useState(1);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 2;

  // Reset page when query changes
  useMemo(() => { setPage(1); }, [trimmed]);

  const searchParams = {
    query: trimmed,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
    page,
  };
  const { data: results, isLoading, isFetching } = useSearchManga(searchParams as any, {
    query: {
      enabled: trimmed.length >= 2,
      queryKey: getSearchMangaQueryKey(searchParams as any),
    },
  });

  const [accumulatedItems, setAccumulatedItems] = useState<any[]>([]);

  // Accumulate items across pages
  useMemo(() => {
    if (!results?.items) return;
    if (page === 1) {
      setAccumulatedItems(results.items);
    } else {
      setAccumulatedItems(prev => {
        const existingIds = new Set(prev.map((m: any) => m.id));
        const newItems = results.items.filter((m: any) => !existingIds.has(m.id));
        return [...prev, ...newItems];
      });
    }
  }, [results, page]);

  // Reset accumulated items when query changes
  useMemo(() => { setAccumulatedItems([]); }, [trimmed]);

  const displayItems = trimmed.length >= 2 ? accumulatedItems : [];
  const hasNextPage = (results as any)?.hasNextPage ?? false;
  const totalCount = (results as any)?.total ?? null;

  const handleLoadMore = () => setPage(p => p + 1);

  return (
    <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl animate-in fade-in duration-500">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-2">
          {trimmed ? `Results for "${trimmed}"` : "Search"}
        </h1>
        {trimmed && !tooShort && !isLoading && displayItems.length > 0 && (
          <p className="text-sm sm:text-base text-muted-foreground">
            {totalCount != null
              ? `${displayItems.length} of ${totalCount.toLocaleString()} titles`
              : `${displayItems.length} title${displayItems.length === 1 ? "" : "s"} loaded`}
            {hasNextPage && " — more available"}
          </p>
        )}
      </div>

      {!trimmed ? (
        <div className="max-w-2xl">
          {searchHistory.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Recent Searches
                </h3>
                <Button variant="ghost" size="sm" onClick={() => storeActions.clearSearchHistory()} className="h-8 text-muted-foreground">
                  Clear All
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {searchHistory.map((term) => (
                  <Button
                    key={term}
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => {
                      storeActions.pushSearch(term);
                      setLocation(`/search?query=${encodeURIComponent(term)}`);
                    }}
                  >
                    {term}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-center px-4 border rounded-2xl bg-card/50">
              <SearchIcon className="h-16 w-16 text-muted mb-6" />
              <h3 className="text-xl font-serif font-bold text-foreground mb-2">Search our catalog</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Type at least two characters to find a series by title, author, or artist.
              </p>
            </div>
          )}
        </div>
      ) : tooShort ? (
        <div className="py-12 text-center text-muted-foreground border rounded-2xl bg-card/50">
          Type at least 2 characters to search.
        </div>
      ) : isLoading && displayItems.length === 0 ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : displayItems.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground border rounded-2xl bg-card/50 px-4">
          <p className="mb-1">No results found for "{trimmed}".</p>
          <p className="text-sm">Try a different search term or check spelling.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-5">
            {displayItems.map((manga: any) => (
              <MangaCard key={manga.id} manga={manga} />
            ))}
          </div>

          {/* Load more */}
          {hasNextPage && (
            <div className="flex justify-center mt-8">
              <Button
                variant="outline"
                className="gap-2 px-8"
                onClick={handleLoadMore}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                {isFetching ? "Loading…" : "Load More"}
              </Button>
            </div>
          )}
          {isFetching && displayItems.length > 0 && !hasNextPage && (
            <div className="flex justify-center mt-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </>
      )}
    </main>
  );
}
