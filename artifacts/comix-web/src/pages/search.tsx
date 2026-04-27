import { useSearch, useLocation } from "wouter";
import { useSearchManga, getSearchMangaQueryKey } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { MangaCard } from "@/components/manga-card";
import { Loader2, X, Search as SearchIcon, Clock } from "lucide-react";
import { useMemo, useEffect, useState } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "@/components/ui/button";

export default function SearchPage() {
  const searchString = useSearch();
  const query = useMemo(() => new URLSearchParams(searchString).get("query") || "", [searchString]);
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const searchHistory = useStore(s => s.searchHistory);

  const searchParams = {
    query,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
  };
  const { data: results, isLoading } = useSearchManga(searchParams, {
    query: {
      enabled: !!query,
      queryKey: getSearchMangaQueryKey(searchParams),
    },
  });

  return (
    <main className="container mx-auto px-4 py-8 max-w-7xl animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">
          {query ? `Search results for "${query}"` : "Search"}
        </h1>
        {query && (
          <p className="text-muted-foreground">
            {results?.items.length || 0} titles found
          </p>
        )}
      </div>

      {!query ? (
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
                    className="rounded-full flex items-center gap-1 group pl-4 pr-2"
                    onClick={() => {
                      storeActions.pushSearch(term);
                      setLocation(`/search?query=${encodeURIComponent(term)}`);
                    }}
                  >
                    {term}
                    <div 
                      className="ml-1 p-1 rounded-full hover:bg-background/50 text-muted-foreground group-hover:text-foreground transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        // This is a bit hacky since there's no remove specific search history, we just clear all for now
                        // Alternatively we could add removeSearch to store, but let's just leave it or add it
                        const newH = searchHistory.filter(x => x !== term);
                        // Access internal state via a hack or just don't allow individual removal. 
                        // Let's just do nothing on X for now, or implement a full remove.
                      }}
                    >
                      {/* <X className="h-3 w-3" /> */}
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-center px-4 border rounded-2xl bg-card/50">
              <SearchIcon className="h-16 w-16 text-muted mb-6" />
              <h3 className="text-xl font-serif font-bold text-foreground mb-2">Search our catalog</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Enter a search term or paste a comix.to URL in the search bar above.
              </p>
            </div>
          )}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : results?.items.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground border rounded-2xl bg-card/50">
          No results found for "{query}". Try a different search term.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {results?.items.map((manga) => (
            <MangaCard key={manga.id} manga={manga} />
          ))}
        </div>
      )}
    </main>
  );
}
