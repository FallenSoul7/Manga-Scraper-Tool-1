import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { useStore, storeActions } from "@/lib/storage";
import { applyActiveSource } from "@/lib/source";
import { MangaCard } from "@/components/manga-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft, Search, X, SlidersHorizontal, Loader2,
  Sun, Moon, Laptop, Check,
} from "lucide-react";
import type { SourceTag } from "@/lib/header-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MangaSummary { id: string; title: string; thumbnail: string; type: string; isNsfw: boolean }
interface ListResponse { items: MangaSummary[]; page: number; hasNextPage: boolean }
type TagState = "include" | "exclude";
type ActiveTab = "popular" | "latest" | "filter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildQuery(params: Record<string, string | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) { for (const item of v) sp.append(k, item); }
    else sp.append(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

const DEBOUNCE_MS = 220;

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function SourceBrowsePage() {
  const [, params] = useRoute("/sources/:id");
  const sourceId = params?.id || "";
  const installedMap = useStore((s) => s.installedSources);
  const source = installedMap[sourceId];
  const theme = useStore(s => s.theme);
  const { settings } = useSettings();

  // ---- UI state ----
  const [tab, setTab] = useState<ActiveTab>("popular");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");   // raw typing
  const [searchQuery, setSearchQuery] = useState("");   // debounced
  const [tagState, setTagState] = useState<Record<string, TagState>>({});
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ---- Pagination ----
  const [popularPage, setPopularPage] = useState(1);
  const [popularItems, setPopularItems] = useState<MangaSummary[]>([]);
  const [latestPage, setLatestPage] = useState(1);
  const [latestItems, setLatestItems] = useState<MangaSummary[]>([]);
  const [filterPage, setFilterPage] = useState(1);
  const [filterItems, setFilterItems] = useState<MangaSummary[]>([]);

  // Set active source header on enter.
  useEffect(() => {
    if (sourceId && installedMap[sourceId]) {
      storeActions.setActiveSource(sourceId);
      applyActiveSource(sourceId);
    }
  }, [sourceId, installedMap]);

  // Reset everything when source changes.
  useEffect(() => {
    setTab("popular");
    setSearchOpen(false); setSearchInput(""); setSearchQuery("");
    setTagState({});
    setPopularPage(1); setPopularItems([]);
    setLatestPage(1); setLatestItems([]);
    setFilterPage(1); setFilterItems([]);
  }, [sourceId]);

  // Debounce search input → searchQuery.
  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(searchInput.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Reset filter page on query/tag changes.
  useEffect(() => {
    setFilterPage(1);
    setFilterItems([]);
  }, [searchQuery, JSON.stringify(tagState)]);

  // Derived tag lists sent to the API.
  const includedTagIds = useMemo(
    () => Object.entries(tagState).filter(([, s]) => s === "include").map(([id]) => id),
    [tagState],
  );
  const excludedTagIds = useMemo(
    () => Object.entries(tagState).filter(([, s]) => s === "exclude").map(([id]) => `-${id}`),
    [tagState],
  );
  const allTagIds = [...includedTagIds, ...excludedTagIds];
  const hasFilter = allTagIds.length > 0;
  const isFiltering = hasFilter || searchQuery.length > 0;

  // Auto-switch to filter tab & open search when filter becomes active.
  useEffect(() => {
    if (hasFilter) {
      setTab("filter");
      setSearchOpen(true);
    }
  }, [hasFilter]);
  useEffect(() => {
    if (isFiltering && tab !== "filter") setTab("filter");
  }, [isFiltering]);

  // Focus search input when it opens.
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  // ---- Tags ----
  const { data: availableTags = [] } = useQuery<SourceTag[]>({
    queryKey: ["source-tags", sourceId],
    queryFn: () => customFetch<SourceTag[]>(`/api/tags`),
    enabled: !!sourceId && !!source,
    staleTime: 60 * 60 * 1000,
  });

  // ---- Data queries ----
  const commonOpts = {
    nsfw: settings.hideNsfw ? "false" : "true",
    poster: settings.posterQuality,
  };

  const popularQuery = useQuery<ListResponse>({
    queryKey: ["source-popular", sourceId, popularPage, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/popular${buildQuery({ ...commonOpts, page: String(popularPage) })}`),
    enabled: !!sourceId && !!source && tab === "popular",
    staleTime: 5 * 60 * 1000,
  });

  const latestQuery = useQuery<ListResponse>({
    queryKey: ["source-latest", sourceId, latestPage, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/latest${buildQuery({ ...commonOpts, page: String(latestPage) })}`),
    enabled: !!sourceId && !!source && tab === "latest",
    staleTime: 5 * 60 * 1000,
  });

  const filterQuery = useQuery<ListResponse>({
    queryKey: ["source-filter", sourceId, searchQuery, allTagIds.join(","), filterPage, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/search${buildQuery({
      ...commonOpts,
      query: searchQuery || undefined,
      page: String(filterPage),
      "tagIds[]": allTagIds,
    })}`),
    enabled: !!sourceId && !!source && tab === "filter" && isFiltering,
    staleTime: 30 * 1000,
  });

  // Merge paginated results.
  useEffect(() => {
    if (!popularQuery.data) return;
    setPopularItems(prev =>
      popularPage === 1 ? popularQuery.data!.items
        : [...prev, ...popularQuery.data!.items.filter(m => !prev.some(p => p.id === m.id))]
    );
  }, [popularQuery.data, popularPage]);

  useEffect(() => {
    if (!latestQuery.data) return;
    setLatestItems(prev =>
      latestPage === 1 ? latestQuery.data!.items
        : [...prev, ...latestQuery.data!.items.filter(m => !prev.some(p => p.id === m.id))]
    );
  }, [latestQuery.data, latestPage]);

  useEffect(() => {
    if (!filterQuery.data) return;
    setFilterItems(prev =>
      filterPage === 1 ? filterQuery.data!.items
        : [...prev, ...filterQuery.data!.items.filter(m => !prev.some(p => p.id === m.id))]
    );
  }, [filterQuery.data, filterPage]);

  // ---- Tag cycling: neutral → include → exclude → neutral ----
  const cycleTag = useCallback((id: string) => {
    setTagState(prev => {
      const cur = prev[id];
      if (!cur) return { ...prev, [id]: "include" };
      if (cur === "include") return { ...prev, [id]: "exclude" };
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const clearFilter = () => {
    setTagState({});
    setSearchInput(""); setSearchQuery("");
    setTab("popular");
    setSearchOpen(false);
  };

  // ---- Tag popover grouping ----
  const groupedTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const map = new Map<string, SourceTag[]>();
    for (const t of availableTags) {
      if (q && !t.name.toLowerCase().includes(q)) continue;
      const key = t.group ?? "Tags";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [availableTags, tagSearch]);

  const activeTagCount = Object.keys(tagState).length;

  // ---- Render helpers ----
  const TabBtn = ({ value, label }: { value: ActiveTab; label: string }) => (
    <button
      type="button"
      onClick={() => { setTab(value); if (value !== "filter") clearFilter(); }}
      className={`px-4 py-2 text-sm font-medium rounded-full transition-colors whitespace-nowrap ${
        tab === value
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );

  if (!source) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Source not installed.</p>
        <Link href="/sources"><Button variant="outline">Back to sources</Button></Link>
      </div>
    );
  }

  // Determine which grid to show.
  let gridItems: MangaSummary[] = [];
  let gridLoading = false;
  let gridFetching = false;
  let gridHasNext = false;
  let gridLoadMore = () => {};

  if (tab === "popular") {
    gridItems = popularItems; gridLoading = popularQuery.isFetching && popularItems.length === 0;
    gridFetching = popularQuery.isFetching; gridHasNext = !!popularQuery.data?.hasNextPage;
    gridLoadMore = () => setPopularPage(p => p + 1);
  } else if (tab === "latest") {
    gridItems = latestItems; gridLoading = latestQuery.isFetching && latestItems.length === 0;
    gridFetching = latestQuery.isFetching; gridHasNext = !!latestQuery.data?.hasNextPage;
    gridLoadMore = () => setLatestPage(p => p + 1);
  } else {
    gridItems = filterItems; gridLoading = filterQuery.isFetching && filterItems.length === 0;
    gridFetching = filterQuery.isFetching; gridHasNext = !!filterQuery.data?.hasNextPage;
    gridLoadMore = () => setFilterPage(p => p + 1);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">

        {/* Title row */}
        <div className="flex items-center gap-3 px-4 h-14">
          {/* Source title */}
          <div className="flex-1 min-w-0">
            <h1 className="font-serif font-bold text-lg sm:text-xl truncate leading-tight">{source.name}</h1>
            <p className="text-[11px] text-muted-foreground leading-none mt-0.5">
              {source.lang.toUpperCase()}
              {source.isNsfw && <span className="ml-1.5 text-rose-500">18+</span>}
            </p>
          </div>

          {/* Right controls: ← back · search · theme */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Back — sits right before search, very close */}
            <Link href="/sources">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Back to sources">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>

            {/* Search toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Search"
              onClick={() => setSearchOpen(o => !o)}
            >
              <Search className="h-5 w-5" />
            </Button>

            {/* Theme */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" aria-label="Theme">
                  {theme === "light" ? <Sun className="h-5 w-5" /> : theme === "dark" ? <Moon className="h-5 w-5" /> : <Laptop className="h-5 w-5" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => storeActions.setTheme("light")}><Sun className="mr-2 h-4 w-4" />Light</DropdownMenuItem>
                <DropdownMenuItem onClick={() => storeActions.setTheme("dark")}><Moon className="mr-2 h-4 w-4" />Dark</DropdownMenuItem>
                <DropdownMenuItem onClick={() => storeActions.setTheme("system")}><Laptop className="mr-2 h-4 w-4" />System</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Expanding search bar */}
        {searchOpen && (
          <div className="px-4 pb-3 animate-in slide-in-from-top-1 duration-150">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchInputRef}
                type="search"
                placeholder={`Search ${source.name}…`}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="pl-9 pr-9 rounded-full bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/50"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => { setSearchInput(""); setSearchQuery(""); searchInputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tab bar: Popular · Latest · Filter */}
        <div className="flex items-center gap-1 px-4 pb-3">
          <TabBtn value="popular" label="Popular" />
          <TabBtn value="latest" label="Latest" />

          {/* Filter button — opens tag picker */}
          <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-colors whitespace-nowrap border ${
                  activeTagCount > 0
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filter
                {activeTagCount > 0 && (
                  <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-background/30 text-[11px] font-bold">
                    {activeTagCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[340px] sm:w-[400px] p-0" sideOffset={8}>
              <TagPicker
                tags={availableTags}
                tagState={tagState}
                onCycle={cycleTag}
                search={tagSearch}
                onSearchChange={setTagSearch}
                grouped={groupedTags}
                onClearAll={() => { setTagState({}); setTagSearch(""); }}
                onApply={() => {
                  setFilterPopoverOpen(false);
                  if (Object.keys(tagState).length > 0) {
                    setTab("filter");
                    setSearchOpen(true);
                  }
                }}
              />
            </PopoverContent>
          </Popover>

          {/* Clear all filter state */}
          {(isFiltering) && (
            <button
              type="button"
              onClick={clearFilter}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {/* Active tag pills summary */}
        {activeTagCount > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
            {Object.entries(tagState).map(([id, state]) => {
              const tag = availableTags.find(t => t.id === id);
              if (!tag) return null;
              return (
                <span
                  key={id}
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border cursor-pointer ${
                    state === "include"
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-destructive/10 text-destructive border-destructive/30"
                  }`}
                  onClick={() => cycleTag(id)}
                >
                  {state === "include"
                    ? <Check className="h-3 w-3" />
                    : <X className="h-3 w-3" />
                  }
                  {tag.name}
                </span>
              );
            })}
          </div>
        )}
      </header>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
        {tab === "filter" && !isFiltering ? (
          <div className="text-center text-muted-foreground py-20">
            <SlidersHorizontal className="h-12 w-12 mx-auto mb-4 text-muted" />
            <p className="font-medium mb-1">No filter active</p>
            <p className="text-sm">Pick tags from the Filter button or type a search above.</p>
          </div>
        ) : (
          <Grid
            items={gridItems}
            loading={gridLoading}
            fetching={gridFetching}
            hasNext={gridHasNext}
            onLoadMore={gridLoadMore}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
interface GridProps {
  items: MangaSummary[];
  loading: boolean;
  fetching: boolean;
  hasNext: boolean;
  onLoadMore: () => void;
}

function Grid({ items, loading, fetching, hasNext, onLoadMore }: GridProps) {
  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (items.length === 0) {
    return <div className="text-center text-muted-foreground py-20">No titles found.</div>;
  }
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
        {items.map(m => <MangaCard key={m.id} manga={m as any} />)}
      </div>
      {hasNext && (
        <div className="flex justify-center mt-8">
          <Button variant="outline" size="lg" className="rounded-full px-8" disabled={fetching} onClick={onLoadMore}>
            {fetching ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading…</> : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// TagPicker popover content
// ---------------------------------------------------------------------------
interface TagPickerProps {
  tags: SourceTag[];
  tagState: Record<string, TagState>;
  onCycle: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  grouped: [string, SourceTag[]][];
  onClearAll: () => void;
  onApply: () => void;
}

function TagPicker({ tagState, onCycle, search, onSearchChange, grouped, onClearAll, onApply }: TagPickerProps) {
  const activeCount = Object.keys(tagState).length;

  return (
    <>
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Filter by tag</h4>
          {activeCount > 0 && (
            <button type="button" onClick={onClearAll} className="text-xs text-muted-foreground hover:text-foreground">
              Clear all
            </button>
          )}
        </div>
        {/* Tag search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Find tag…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Check className="h-3 w-3 text-primary" /> Include</span>
          <span className="flex items-center gap-1"><X className="h-3 w-3 text-destructive" /> Exclude</span>
          <span className="ml-auto italic">click to cycle</span>
        </div>
      </div>

      <div className="max-h-[300px] overflow-y-auto p-2">
        {grouped.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">No tags match.</div>
        ) : (
          grouped.map(([group, items]) => (
            <div key={group} className="mb-3 last:mb-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 mb-1">{group}</div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {items.map(t => {
                  const state = tagState[t.id];
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onCycle(t.id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-all cursor-pointer ${
                        state === "include"
                          ? "bg-primary text-primary-foreground border-primary"
                          : state === "exclude"
                          ? "bg-destructive/15 text-destructive border-destructive/40"
                          : "bg-card hover:bg-muted border-border text-foreground"
                      }`}
                    >
                      {state === "include" && <Check className="h-3 w-3" />}
                      {state === "exclude" && <X className="h-3 w-3" />}
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t">
        <Button onClick={onApply} className="w-full" size="sm" disabled={activeCount === 0}>
          Apply{activeCount > 0 ? ` (${activeCount} tag${activeCount > 1 ? "s" : ""})` : ""}
        </Button>
      </div>
    </>
  );
}
