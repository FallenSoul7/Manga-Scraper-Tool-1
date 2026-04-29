import { useEffect, useState, useMemo } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetPopular,
  useGetLatest,
  useSearchManga,
  getGetPopularQueryKey,
  getGetLatestQueryKey,
  getSearchMangaQueryKey,
} from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { useStore, storeActions } from "@/lib/storage";
import { applyActiveSource } from "@/lib/source";
import { MangaCard } from "@/components/manga-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ArrowLeft, X } from "lucide-react";

const TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
  { value: "manga", label: "Manga" },
];

export default function SourceBrowsePage() {
  const [, params] = useRoute("/sources/:id");
  const sourceId = params?.id || "";
  const installedMap = useStore((s) => s.installedSources);
  const source = installedMap[sourceId];

  const { settings } = useSettings();

  const [popularPage, setPopularPage] = useState(1);
  const [latestPage, setLatestPage] = useState(1);
  const [popularItems, setPopularItems] = useState<any[]>([]);
  const [latestItems, setLatestItems] = useState<any[]>([]);

  const [search, setSearch] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [searchItems, setSearchItems] = useState<any[]>([]);
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [tab, setTab] = useState("popular");
  const [typeFilter, setTypeFilter] = useState("all");

  // Switch the active source as soon as we land here so all queries
  // (which use the X-Source header) target this extension.
  useEffect(() => {
    if (sourceId && installedMap[sourceId]) {
      storeActions.setActiveSource(sourceId);
      applyActiveSource(sourceId);
    }
  }, [sourceId, installedMap]);

  // Reset accumulated lists when source/filters change.
  useEffect(() => {
    setPopularPage(1);
    setPopularItems([]);
    setLatestPage(1);
    setLatestItems([]);
    setSearchItems([]);
    setSearchPage(1);
    setSubmittedSearch("");
    setSearch("");
    setTab("popular");
    setTypeFilter("all");
  }, [sourceId]);

  const popularParams = {
    page: popularPage,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
  };
  const { data: popular, isFetching: popularFetching } = useGetPopular(popularParams, {
    query: { queryKey: [...getGetPopularQueryKey(popularParams), sourceId], enabled: tab === "popular" && !submittedSearch },
  });

  const latestParams = {
    page: latestPage,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
  };
  const { data: latest, isFetching: latestFetching } = useGetLatest(latestParams, {
    query: { queryKey: [...getGetLatestQueryKey(latestParams), sourceId], enabled: tab === "latest" && !submittedSearch },
  });

  const searchParams = {
    query: submittedSearch,
    page: searchPage,
    nsfw: !settings.hideNsfw,
    poster: settings.posterQuality,
  };
  const { data: searchData, isFetching: searchFetching } = useSearchManga(searchParams, {
    query: {
      queryKey: [...getSearchMangaQueryKey(searchParams), sourceId],
      enabled: !!submittedSearch,
    },
  });

  useEffect(() => {
    if (!popular?.items) return;
    setPopularItems((prev) => {
      if (popularPage === 1) return popular.items;
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...popular.items.filter((m) => !seen.has(m.id))];
    });
  }, [popular, popularPage]);

  useEffect(() => {
    if (!latest?.items) return;
    setLatestItems((prev) => {
      if (latestPage === 1) return latest.items;
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...latest.items.filter((m) => !seen.has(m.id))];
    });
  }, [latest, latestPage]);

  useEffect(() => {
    if (!searchData?.items) return;
    setSearchItems((prev) => {
      if (searchPage === 1) return searchData.items;
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...searchData.items.filter((m) => !seen.has(m.id))];
    });
  }, [searchData, searchPage]);

  const applyTypeFilter = (items: any[]) =>
    typeFilter === "all"
      ? items
      : items.filter((m) => (m.type || "").toLowerCase() === typeFilter);

  const visiblePopular = useMemo(() => applyTypeFilter(popularItems), [popularItems, typeFilter]);
  const visibleLatest = useMemo(() => applyTypeFilter(latestItems), [latestItems, typeFilter]);
  const visibleSearch = useMemo(() => applyTypeFilter(searchItems), [searchItems, typeFilter]);

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    setSubmittedSearch(q);
    setSearchPage(1);
    setSearchItems([]);
  };

  const clearSearch = () => {
    setSearch("");
    setSubmittedSearch("");
    setSearchItems([]);
    setSearchPage(1);
  };

  if (!source) {
    return (
      <main className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground mb-4">Source not installed.</p>
        <Link href="/sources">
          <Button variant="outline">Back to sources</Button>
        </Link>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 pt-4 sm:pt-6 pb-8 max-w-7xl animate-in fade-in duration-300">
      <Link href="/sources" className="inline-flex items-center text-muted-foreground hover:text-primary mb-4 transition-colors text-sm">
        <ArrowLeft className="mr-2 h-4 w-4" /> All sources
      </Link>

      <div className="mb-5 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold mb-1">{source.name}</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {source.lang.toUpperCase()} · {source.id}
          {source.isNsfw && <span className="ml-2 text-rose-500">18+</span>}
        </p>
      </div>

      {/* Per-source search */}
      <form onSubmit={onSubmitSearch} className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={`Search ${source.name}…`}
          className="pl-9 pr-10 h-11 rounded-full bg-muted/50"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {(search || submittedSearch) && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted"
            aria-label="Clear search"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </form>

      {/* Type filter pills */}
      <div className="flex items-center gap-2 mb-5 sm:mb-6 overflow-x-auto hide-scrollbar pb-1">
        {TYPE_FILTERS.map((t) => {
          const active = typeFilter === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTypeFilter(t.value)}
              className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted border-border text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {submittedSearch ? (
        <SearchResults
          items={visibleSearch}
          loading={searchFetching && searchItems.length === 0}
          fetching={searchFetching}
          hasNext={!!searchData?.hasNextPage}
          onLoadMore={() => setSearchPage((p) => p + 1)}
          query={submittedSearch}
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="mb-5 sm:mb-6">
            <TabsTrigger value="popular" className="text-sm sm:text-base px-4 sm:px-6">Popular</TabsTrigger>
            <TabsTrigger value="latest" className="text-sm sm:text-base px-4 sm:px-6">Latest</TabsTrigger>
          </TabsList>

          <TabsContent value="popular" className="space-y-8 animate-in fade-in duration-300">
            <Grid
              items={visiblePopular}
              loading={popularFetching && popularItems.length === 0}
              fetching={popularFetching}
              hasNext={!!popular?.hasNextPage}
              onLoadMore={() => setPopularPage((p) => p + 1)}
            />
          </TabsContent>

          <TabsContent value="latest" className="space-y-8 animate-in fade-in duration-300">
            <Grid
              items={visibleLatest}
              loading={latestFetching && latestItems.length === 0}
              fetching={latestFetching}
              hasNext={!!latest?.hasNextPage}
              onLoadMore={() => setLatestPage((p) => p + 1)}
            />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

function Grid({
  items,
  loading,
  fetching,
  hasNext,
  onLoadMore,
}: {
  items: any[];
  loading: boolean;
  fetching: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-16">
        No titles match your filter.
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
        {items.map((m) => (
          <MangaCard key={m.id} manga={m} />
        ))}
      </div>
      {hasNext && (
        <div className="flex justify-center mt-8">
          <Button
            variant="outline"
            size="lg"
            className="rounded-full px-8"
            disabled={fetching}
            onClick={onLoadMore}
          >
            {fetching ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…</> : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}

function SearchResults(props: {
  items: any[];
  loading: boolean;
  fetching: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
  query: string;
}) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Results for <span className="text-foreground font-medium">"{props.query}"</span>
      </div>
      <Grid {...props} />
    </div>
  );
}
