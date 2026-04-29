import { useEffect, useState, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { useStore, storeActions } from "@/lib/storage";
import { applyActiveSource } from "@/lib/source";
import { useRegisterHeaderSearch, type SourceTag } from "@/lib/header-search";
import { MangaCard } from "@/components/manga-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";

interface MangaSummary {
  id: string;
  title: string;
  thumbnail: string;
  type: string;
  isNsfw: boolean;
}

interface ListResponse {
  items: MangaSummary[];
  page: number;
  hasNextPage: boolean;
}

function buildQuery(params: Record<string, string | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) {
      for (const item of v) sp.append(k, item);
    } else {
      sp.append(k, v);
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function SourceBrowsePage() {
  const [, params] = useRoute("/sources/:id");
  const sourceId = params?.id || "";
  const installedMap = useStore((s) => s.installedSources);
  const source = installedMap[sourceId];
  const { settings } = useSettings();

  // What the user is currently filtering by, driven from the global header.
  const [query, setQuery] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tab, setTab] = useState<"popular" | "latest">("popular");

  // Pagination + accumulated lists for the three flows: popular, latest,
  // search/tag-filtered. Reset whenever the filter, source, or tab changes.
  const [popularPage, setPopularPage] = useState(1);
  const [popularItems, setPopularItems] = useState<MangaSummary[]>([]);
  const [latestPage, setLatestPage] = useState(1);
  const [latestItems, setLatestItems] = useState<MangaSummary[]>([]);
  const [filterPage, setFilterPage] = useState(1);
  const [filterItems, setFilterItems] = useState<MangaSummary[]>([]);

  // Switch the active source as soon as we land here so anything keyed by the
  // X-Source header is consistent.
  useEffect(() => {
    if (sourceId && installedMap[sourceId]) {
      storeActions.setActiveSource(sourceId);
      applyActiveSource(sourceId);
    }
  }, [sourceId, installedMap]);

  // Reset accumulated lists & filter state when the source changes.
  useEffect(() => {
    setPopularPage(1); setPopularItems([]);
    setLatestPage(1); setLatestItems([]);
    setFilterPage(1); setFilterItems([]);
    setQuery(""); setTagIds([]); setTab("popular");
  }, [sourceId]);

  // Reset the filter list whenever the inputs change so we don't paginate over
  // stale results.
  useEffect(() => {
    setFilterPage(1);
    setFilterItems([]);
  }, [query, tagIds.join(","), sourceId]);

  // ---- Tags ----
  const { data: availableTags = [] } = useQuery<SourceTag[]>({
    queryKey: ["source-tags", sourceId],
    queryFn: () => customFetch<SourceTag[]>(`/api/tags`),
    enabled: !!sourceId && !!source,
    staleTime: 60 * 60 * 1000,
  });

  // Hook the global header search up to this page.
  useRegisterHeaderSearch(
    {
      placeholder: source ? `Search ${source.name}…` : "Search…",
      initialQuery: query,
      initialTagIds: tagIds,
      availableTags,
      onChange: (q, ids) => {
        setQuery(q);
        setTagIds(ids);
      },
    },
    [sourceId, source?.name, availableTags],
  );

  const isFiltering = query.trim().length > 0 || tagIds.length > 0;

  // ---- Listings ----
  const popularQuery = useQuery<ListResponse>({
    queryKey: ["source-popular", sourceId, popularPage, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/popular${buildQuery({
      page: String(popularPage),
      nsfw: settings.hideNsfw ? "false" : "true",
      poster: settings.posterQuality,
    })}`),
    enabled: !!sourceId && !isFiltering && tab === "popular",
    staleTime: 5 * 60 * 1000,
  });

  const latestQuery = useQuery<ListResponse>({
    queryKey: ["source-latest", sourceId, latestPage, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/latest${buildQuery({
      page: String(latestPage),
      nsfw: settings.hideNsfw ? "false" : "true",
      poster: settings.posterQuality,
    })}`),
    enabled: !!sourceId && !isFiltering && tab === "latest",
    staleTime: 5 * 60 * 1000,
  });

  // Search + tag filter share the same endpoint (the server falls back to
  // popular when there's no text but tag filters are present).
  const filterQuery = useQuery<ListResponse>({
    queryKey: [
      "source-filter",
      sourceId,
      query.trim(),
      tagIds.join(","),
      filterPage,
      settings.hideNsfw,
      settings.posterQuality,
    ],
    queryFn: () => customFetch<ListResponse>(`/api/search${buildQuery({
      query: query.trim() || undefined,
      page: String(filterPage),
      nsfw: settings.hideNsfw ? "false" : "true",
      poster: settings.posterQuality,
      "tagIds[]": tagIds,
    })}`),
    enabled: !!sourceId && isFiltering,
    staleTime: 30 * 1000,
  });

  // Merge fresh pages into the accumulator for each flow, deduping by id.
  useEffect(() => {
    if (!popularQuery.data) return;
    setPopularItems((prev) => {
      if (popularPage === 1) return popularQuery.data!.items;
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...popularQuery.data!.items.filter((m) => !seen.has(m.id))];
    });
  }, [popularQuery.data, popularPage]);

  useEffect(() => {
    if (!latestQuery.data) return;
    setLatestItems((prev) => {
      if (latestPage === 1) return latestQuery.data!.items;
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...latestQuery.data!.items.filter((m) => !seen.has(m.id))];
    });
  }, [latestQuery.data, latestPage]);

  useEffect(() => {
    if (!filterQuery.data) return;
    setFilterItems((prev) => {
      if (filterPage === 1) return filterQuery.data!.items;
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...filterQuery.data!.items.filter((m) => !seen.has(m.id))];
    });
  }, [filterQuery.data, filterPage]);

  const activeTagNames = useMemo(
    () => availableTags.filter((t) => tagIds.includes(t.id)).map((t) => t.name),
    [availableTags, tagIds],
  );

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
    <main className="container mx-auto px-4 pt-3 sm:pt-4 pb-8 max-w-7xl animate-in fade-in duration-300">
      <Link href="/sources" className="inline-flex items-center text-muted-foreground hover:text-primary mb-3 sm:mb-4 transition-colors text-sm">
        <ArrowLeft className="mr-2 h-4 w-4" /> All sources
      </Link>

      <div className="mb-4 sm:mb-5">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold mb-1">{source.name}</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {source.lang.toUpperCase()} · {source.id}
          {source.isNsfw && <span className="ml-2 text-rose-500">18+</span>}
        </p>
      </div>

      {isFiltering ? (
        <FilteredView
          items={filterItems}
          loading={filterQuery.isFetching && filterItems.length === 0}
          fetching={filterQuery.isFetching}
          hasNext={!!filterQuery.data?.hasNextPage}
          onLoadMore={() => setFilterPage((p) => p + 1)}
          query={query.trim()}
          tagNames={activeTagNames}
        />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "popular" | "latest")} className="w-full">
          <TabsList className="mb-5 sm:mb-6">
            <TabsTrigger value="popular" className="text-sm sm:text-base px-4 sm:px-6">Popular</TabsTrigger>
            <TabsTrigger value="latest" className="text-sm sm:text-base px-4 sm:px-6">Latest</TabsTrigger>
          </TabsList>

          <TabsContent value="popular" className="space-y-8 animate-in fade-in duration-300">
            <Grid
              items={popularItems}
              loading={popularQuery.isFetching && popularItems.length === 0}
              fetching={popularQuery.isFetching}
              hasNext={!!popularQuery.data?.hasNextPage}
              onLoadMore={() => setPopularPage((p) => p + 1)}
            />
          </TabsContent>

          <TabsContent value="latest" className="space-y-8 animate-in fade-in duration-300">
            <Grid
              items={latestItems}
              loading={latestQuery.isFetching && latestItems.length === 0}
              fetching={latestQuery.isFetching}
              hasNext={!!latestQuery.data?.hasNextPage}
              onLoadMore={() => setLatestPage((p) => p + 1)}
            />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

interface GridProps {
  items: MangaSummary[];
  loading: boolean;
  fetching: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
}

function Grid({ items, loading, fetching, hasNext, onLoadMore }: GridProps) {
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
        No titles found.
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
        {items.map((m) => (
          <MangaCard key={m.id} manga={m as any} />
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

function FilteredView(props: GridProps & { query: string; tagNames: string[] }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5">
        <span>Showing</span>
        {props.query && (
          <span className="text-foreground font-medium">"{props.query}"</span>
        )}
        {props.query && props.tagNames.length > 0 && <span>tagged with</span>}
        {props.query.length === 0 && props.tagNames.length > 0 && <span>tagged with</span>}
        {props.tagNames.map((n) => (
          <span key={n} className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
            {n}
          </span>
        ))}
      </div>
      <Grid
        items={props.items}
        loading={props.loading}
        fetching={props.fetching}
        hasNext={props.hasNext}
        onLoadMore={props.onLoadMore}
      />
    </div>
  );
}
