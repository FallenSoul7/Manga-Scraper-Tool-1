import { useSearch, useLocation } from "wouter";
import { useSearchManga, getSearchMangaQueryKey } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { MangaCard } from "@/components/manga-card";
import { Loader2, Search as SearchIcon, Clock } from "lucide-react";
import { useMemo } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "@/components/ui/button";

function tokenize(q: string): string[] {
  return q.toLowerCase().split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2);
}

function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  const h = haystack.toLowerCase();
  return tokens.every(t => h.includes(t));
}

export default function SearchPage() {
  const searchString = useSearch();
  const query = useMemo(() => new URLSearchParams(searchString).get("query") || "", [searchString]);
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const searchHistory = useStore(s => s.searchHistory);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 2;

  const searchParams = {
    query: trimmed,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
  };
  const { data: results, isLoading } = useSearchManga(searchParams, {
    query: {
      enabled: trimmed.length >= 2,
      queryKey: getSearchMangaQueryKey(searchParams),
    },
  });

  // Word-token filtering: server search is too loose (matches single letters).
  // Require every token (>=2 chars) of the query to appear somewhere in the title /
  // alternative titles / author so results are meaningful.
  const filteredResults = useMemo(() => {
    if (!results?.items) return [];
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return results.items;
    return results.items.filter((m: any) => {
      const haystack = [
        m.title || "",
        ...(m.altTitles || []),
        m.author || "",
        m.artist || "",
      ].join(" \u0001 ");
      return matchesAllTokens(haystack, tokens);
    });
  }, [results, trimmed]);

  return (
    <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl animate-in fade-in duration-500">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-2">
          {trimmed ? `Search results for "${trimmed}"` : "Search"}
        </h1>
        {trimmed && !tooShort && (
          <p className="text-sm sm:text-base text-muted-foreground">
            {filteredResults.length} {filteredResults.length === 1 ? "title" : "titles"} found
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
      ) : isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : filteredResults.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground border rounded-2xl bg-card/50 px-4">
          <p className="mb-1">No results found for "{trimmed}".</p>
          <p className="text-sm">Try a different search term or check spelling.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {filteredResults.map((manga: any) => (
            <MangaCard key={manga.id} manga={manga} />
          ))}
        </div>
      )}
    </main>
  );
}
