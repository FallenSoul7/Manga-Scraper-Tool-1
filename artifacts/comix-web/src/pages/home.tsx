import { useEffect, useState } from "react";
import { useGetPopular, useGetLatest, getGetPopularQueryKey, getGetLatestQueryKey } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { MangaCard } from "@/components/manga-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { settings } = useSettings();
  const [popularPage, setPopularPage] = useState(1);
  const [latestPage, setLatestPage] = useState(1);

  // Accumulated lists, deduped by id, so "Load More" appends instead of replacing
  const [popularItems, setPopularItems] = useState<any[]>([]);
  const [latestItems, setLatestItems] = useState<any[]>([]);

  // Reset when filters change (NSFW, poster) since results would be different
  useEffect(() => {
    setPopularPage(1);
    setPopularItems([]);
    setLatestPage(1);
    setLatestItems([]);
  }, [settings.hideNsfw, settings.posterQuality]);

  const popularParams = {
    page: popularPage,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
  };
  const { data: popular, isFetching: popularFetching } = useGetPopular(popularParams, {
    query: { queryKey: getGetPopularQueryKey(popularParams) },
  });

  const latestParams = {
    page: latestPage,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
  };
  const { data: latest, isFetching: latestFetching } = useGetLatest(latestParams, {
    query: { queryKey: getGetLatestQueryKey(latestParams) },
  });

  useEffect(() => {
    if (!popular?.items) return;
    setPopularItems(prev => {
      if (popularPage === 1) return popular.items;
      const seen = new Set(prev.map(m => m.id));
      const fresh = popular.items.filter(m => !seen.has(m.id));
      return [...prev, ...fresh];
    });
  }, [popular, popularPage]);

  useEffect(() => {
    if (!latest?.items) return;
    setLatestItems(prev => {
      if (latestPage === 1) return latest.items;
      const seen = new Set(prev.map(m => m.id));
      const fresh = latest.items.filter(m => !seen.has(m.id));
      return [...prev, ...fresh];
    });
  }, [latest, latestPage]);

  const popularLoadingFirst = popularFetching && popularItems.length === 0;
  const latestLoadingFirst = latestFetching && latestItems.length === 0;

  return (
    <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold text-foreground mb-2 sm:mb-4">Discover</h1>
        <p className="text-muted-foreground text-base sm:text-lg">Find your next favorite story in our digital library.</p>
      </div>

      <Tabs defaultValue="popular" className="w-full">
        <TabsList className="mb-6 sm:mb-8">
          <TabsTrigger value="popular" className="text-sm sm:text-base px-4 sm:px-6">Popular</TabsTrigger>
          <TabsTrigger value="latest" className="text-sm sm:text-base px-4 sm:px-6">Latest Updates</TabsTrigger>
        </TabsList>

        <TabsContent value="popular" className="space-y-8 animate-in fade-in duration-500">
          {popularLoadingFirst ? (
            <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
                {popularItems.map((manga) => (
                  <MangaCard key={manga.id} manga={manga} />
                ))}
              </div>
              {popular?.hasNextPage && (
                <div className="flex justify-center mt-8">
                  <Button
                    variant="outline"
                    onClick={() => setPopularPage(p => p + 1)}
                    size="lg"
                    className="rounded-full px-8"
                    disabled={popularFetching}
                  >
                    {popularFetching ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...</> : "Load More"}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="latest" className="space-y-8 animate-in fade-in duration-500">
          {latestLoadingFirst ? (
            <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
                {latestItems.map((manga) => (
                  <MangaCard key={manga.id} manga={manga} />
                ))}
              </div>
              {latest?.hasNextPage && (
                <div className="flex justify-center mt-8">
                  <Button
                    variant="outline"
                    onClick={() => setLatestPage(p => p + 1)}
                    size="lg"
                    className="rounded-full px-8"
                    disabled={latestFetching}
                  >
                    {latestFetching ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...</> : "Load More"}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
