import { useSearch } from "wouter";
import { useSearchManga } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { MangaCard } from "@/components/manga-card";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";

export default function SearchPage() {
  const searchParams = useSearch();
  const query = useMemo(() => new URLSearchParams(searchParams).get("query") || "", [searchParams]);
  const { settings } = useSettings();

  const { data: results, isLoading } = useSearchManga(
    {
      query,
      nsfw: !settings.hideNsfw,
      poster: settings.posterQuality,
    },
    {
      query: { enabled: !!query }
    }
  );

  return (
    <main className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">
          {query ? `Search results for "${query}"` : "Search"}
        </h1>
        <p className="text-muted-foreground">
          {results?.items.length || 0} titles found
        </p>
      </div>

      {!query ? (
        <div className="py-20 text-center text-muted-foreground">
          Enter a search term or paste a comix.to URL above.
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : results?.items.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          No results found for "{query}". Try a different search term.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 animate-in fade-in duration-500">
          {results?.items.map((manga) => (
            <MangaCard key={manga.id} manga={manga} />
          ))}
        </div>
      )}
    </main>
  );
}
