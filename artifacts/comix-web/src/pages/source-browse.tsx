import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRoute, useSearch } from "wouter";
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
  Sun, Moon, Laptop, Check, AlertTriangle, RefreshCw,
} from "lucide-react";
import type { SourceTag } from "@/lib/header-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MangaSummary { id: string; title: string; thumbnail: string; type: string; isNsfw: boolean }
interface ListResponse { items: MangaSummary[]; page: number; hasNextPage: boolean }
interface PageSnapshot {
  tab: ActiveTab;
  popularSort: string | null;
  searchOpen: boolean;
  searchInput: string;
  searchQuery: string;
  appliedTagState: Record<string, TagTriState>;
  popularPage: number;
  latestPage: number;
  filterPage: number;
  popularItems: MangaSummary[];
  latestItems: MangaSummary[];
  filterItems: MangaSummary[];
  scrollY: number;
}
type TagTriState = "include" | "exclude";
type ActiveTab = "popular" | "latest" | "filter";

interface PopularSortOption { value: string; label: string; }
interface CatalogEntry {
  id: string; name: string; lang: string; isNsfw: boolean;
  iconUrl?: string | null; supported?: boolean;
  popularSorts?: PopularSortOption[];
}

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
const VPN_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// VPN / Blocked-source banner (with 10-sec auto-dismiss + 30-min cooldown)
// ---------------------------------------------------------------------------
function VpnBanner({
  sourceId, onRetry, coversAvailable,
}: { sourceId: string; onRetry: () => void; coversAvailable: boolean }) {
  const storageKey = `vpn_banner_${sourceId}`;
  const [visible, setVisible] = useState(() => {
    const last = parseInt(localStorage.getItem(storageKey) || "0");
    return Date.now() - last > VPN_COOLDOWN_MS;
  });
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (!visible) return;
    const iv = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(iv);
          dismiss();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [visible]);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(storageKey, String(Date.now()));
  }

  if (!visible) return null;

  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-3 animate-in slide-in-from-top-2 duration-200">
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          {coversAvailable
            ? "Reading chapters may require a VPN in your region"
            : "This source couldn't be reached — it may be blocked in your region"}
        </p>
        <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">
          {coversAvailable
            ? "Covers are available. If chapters fail to load, try a VPN."
            : "A VPN may help. Auto-dismissing in " + countdown + "s…"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!coversAvailable && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-amber-700 hover:text-amber-900 dark:text-amber-300" onClick={onRetry}>
            <RefreshCw className="h-3 w-3 mr-1" />Retry
          </Button>
        )}
        <button type="button" onClick={dismiss} className="p-1 text-amber-600 hover:text-amber-900 dark:text-amber-400">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function SourceBrowsePage() {
  const [, params] = useRoute("/sources/:id");
  const sourceId = params?.id || "";
  const searchString = useSearch();
  const urlQ = useMemo(() => new URLSearchParams(searchString).get("q") ?? "", [searchString]);
  const urlTagId = useMemo(() => new URLSearchParams(searchString).get("tagId") ?? "", [searchString]);
  const installedMap = useStore((s) => s.installedSources);
  const installedSource = installedMap[sourceId];
  const theme = useStore(s => s.theme);
  const { settings } = useSettings();

  // For non-installed (catalog-only) sources, fetch their info from the catalog.
  const { data: catalogData } = useQuery<{ extensions: CatalogEntry[] }>({
    queryKey: ["catalog"],
    queryFn: () => customFetch<{ extensions: CatalogEntry[] }>("/api/sources/catalog"),
    enabled: !installedSource && !!sourceId,
    staleTime: Infinity,
  });
  const catalogEntry = useMemo(
    () => catalogData?.extensions?.find(e => e.id === sourceId) ?? null,
    [catalogData, sourceId],
  );

  // Unified source info: installed takes priority, catalog is fallback.
  const source = installedSource ?? (catalogEntry ? {
    id: sourceId,
    name: catalogEntry.name,
    lang: catalogEntry.lang,
    isNsfw: catalogEntry.isNsfw,
  } : null);

  // Extra sort options provided by this source (e.g. Most Viewed, Most Fapped on 9Hentai).
  const popularSorts: PopularSortOption[] = catalogEntry?.popularSorts ?? [];

  // ---- Active tab & search state ----
  const [tab, setTab] = useState<ActiveTab>(() => urlTagId ? "filter" : "popular");
  const [popularSort, setPopularSort] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(!!urlQ);
  const [searchInput, setSearchInput] = useState(urlQ);
  const [searchQuery, setSearchQuery] = useState(urlQ);
  const pageScrollKey = `source-scroll:${sourceId}`;
  const pageStateKey = `source-page-state:${sourceId}`;

  // Track whether this is the initial mount so the source-change reset effect
  // doesn't clear a query that arrived via ?q= URL param.
  const isFirstMountRef = useRef(true);

  // Applied filter state (only changes when "Apply" is pressed in the popover).
  // Pre-populated from ?tagId= URL param when navigating from a manga detail page.
  const [appliedTagState, setAppliedTagState] = useState<Record<string, TagTriState>>(
    () => urlTagId ? { [urlTagId]: "include" } : {},
  );
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRestoreRef = useRef<number | null>(null);
  const restoreSnapshotRef = useRef<PageSnapshot | null>(null);
  const hasRestoredRef = useRef(false);

  // ---- Pagination ----
  const [popularPage, setPopularPage] = useState(1);
  const [popularItems, setPopularItems] = useState<MangaSummary[]>([]);
  const [latestPage, setLatestPage] = useState(1);
  const [latestItems, setLatestItems] = useState<MangaSummary[]>([]);
  const [filterPage, setFilterPage] = useState(1);
  const [filterItems, setFilterItems] = useState<MangaSummary[]>([]);

  // Always set source header — even for non-installed (catalog) sources —
  // so the manga detail page uses the correct backend source.
  useEffect(() => {
    if (!sourceId) return;
    applyActiveSource(sourceId);
    if (installedSource) storeActions.setActiveSource(sourceId);
  }, [sourceId, installedSource]);

  // Reset state on source change. Skip search reset on the very first mount
  // so a ?q= URL param coming from global search "See more" is preserved.
  useEffect(() => {
    if (restoreSnapshotRef.current && !hasRestoredRef.current) return;
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    setTab("popular");
    setPopularSort(null);
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
    setAppliedTagState({});
    setPopularPage(1);
    setPopularItems([]);
    setLatestPage(1);
    setLatestItems([]);
    setFilterPage(1);
    setFilterItems([]);
  }, [sourceId]);

  // Reset pagination when sort changes.
  useEffect(() => {
    setPopularPage(1); setPopularItems([]);
    setLatestPage(1); setLatestItems([]);
  }, [popularSort]);

  // Debounce search input.
  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(searchInput.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Reset filter page on query/tag changes.
  const appliedTagKey = JSON.stringify(appliedTagState);
  useEffect(() => { setFilterPage(1); setFilterItems([]); }, [searchQuery, appliedTagKey]);

  // Derived tag lists.
  const includedTagIds = useMemo(
    () => Object.entries(appliedTagState).filter(([, s]) => s === "include").map(([id]) => id),
    [appliedTagState],
  );
  const excludedTagIds = useMemo(
    () => Object.entries(appliedTagState).filter(([, s]) => s === "exclude").map(([id]) => `-${id}`),
    [appliedTagState],
  );
  const allTagIds = [...includedTagIds, ...excludedTagIds];
  const hasAppliedTags = allTagIds.length > 0;
  const isSearching = searchQuery.length > 0;
  const isTagFiltering = hasAppliedTags && !isSearching;
  const isFiltering = hasAppliedTags || isSearching;

  // Focus search input when it opens.
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchOpen]);

  useEffect(() => {
    const raw = sessionStorage.getItem(pageStateKey);
    if (!raw) return;
    try {
      restoreSnapshotRef.current = JSON.parse(raw) as PageSnapshot;
    } catch {}
  }, [pageStateKey]);

  useEffect(() => {
    const snap = restoreSnapshotRef.current;
    if (!snap || hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    setTab(snap.tab);
    setPopularSort(snap.popularSort);
    setSearchOpen(snap.searchOpen);
    setSearchInput(snap.searchInput);
    setSearchQuery(snap.searchQuery);
    setAppliedTagState(snap.appliedTagState);
    setPopularPage(snap.popularPage);
    setLatestPage(snap.latestPage);
    setFilterPage(snap.filterPage);
    setPopularItems(snap.popularItems);
    setLatestItems(snap.latestItems);
    setFilterItems(snap.filterItems);
    requestAnimationFrame(() => window.scrollTo({ top: snap.scrollY, behavior: "auto" }));
  }, [tab, popularPage, latestPage, filterPage]);

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
    queryKey: ["source-popular", sourceId, popularPage, popularSort, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/popular${buildQuery({ ...commonOpts, page: String(popularPage), ...(popularSort ? { sort: popularSort } : {}) })}`),
    enabled: !!sourceId && !!source && tab === "popular" && !isFiltering,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const latestQuery = useQuery<ListResponse>({
    queryKey: ["source-latest", sourceId, latestPage, popularSort, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/latest${buildQuery({ ...commonOpts, page: String(latestPage), ...(popularSort ? { sort: popularSort } : {}) })}`),
    enabled: !!sourceId && !!source && tab === "latest" && !isFiltering,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const filterQuery = useQuery<ListResponse>({
    queryKey: ["source-filter", sourceId, searchQuery, allTagIds.join(","), filterPage, settings.hideNsfw, settings.posterQuality],
    queryFn: () => customFetch<ListResponse>(`/api/search${buildQuery({
      ...commonOpts,
      query: searchQuery || undefined,
      page: String(filterPage),
      "tagIds[]": allTagIds,
    })}`),
    enabled: !!sourceId && !!source && isFiltering,
    staleTime: 30 * 1000,
    retry: 1,
  });

  // Accumulate paginated results.
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

  // ---- Handlers ----
  const handleBrowseTab = useCallback((newTab: "popular" | "latest") => {
    setAppliedTagState({});
    setSearchInput(""); setSearchQuery("");
    setSearchOpen(false);
    setTab(newTab);
  }, []);

  const handleApplyFilter = useCallback((newState: Record<string, TagTriState>) => {
    setAppliedTagState(newState);
    setFilterPopoverOpen(false);
    if (Object.keys(newState).length > 0) setTab("filter");
  }, []);

  // VPN error: shown when the active-tab query errors out.
  const activeQuery = isFiltering ? filterQuery : tab === "latest" ? latestQuery : popularQuery;
  const isSourceError = activeQuery.isError;
  const coversAvailable = !isSourceError && (popularItems.length > 0 || popularQuery.isSuccess);

  useEffect(() => {
    const snapshot: PageSnapshot = {
      tab,
      popularSort,
      searchOpen,
      searchInput,
      searchQuery,
      appliedTagState,
      popularPage,
      latestPage,
      filterPage,
      popularItems,
      latestItems,
      filterItems,
      scrollY: window.scrollY,
    };
    sessionStorage.setItem(pageStateKey, JSON.stringify(snapshot));
    sessionStorage.setItem(pageScrollKey, String(window.scrollY));
  }, [
    pageStateKey,
    pageScrollKey,
    tab,
    popularSort,
    searchOpen,
    searchInput,
    searchQuery,
    appliedTagState,
    popularPage,
    latestPage,
    filterPage,
    popularItems,
    latestItems,
    filterItems,
  ]);

  // While we don't yet know the source (loading from catalog), show a spinner.
  if (!source && !catalogEntry && !!sourceId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!source) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <p className="text-muted-foreground">Source not found.</p>
        <Button variant="outline" onClick={() => window.history.back()}>Go back</Button>
      </div>
    );
  }

  // Decide what grid to show.
  const inSearchMode = isSearching;
  const inFilterMode = isTagFiltering;

  let gridItems: MangaSummary[];
  let gridLoading: boolean;
  let gridFetching: boolean;
  let gridHasNext: boolean;
  let gridLoadMore: () => void;

  if (inSearchMode || inFilterMode) {
    gridItems = filterItems;
    gridLoading = filterQuery.isFetching && filterItems.length === 0;
    gridFetching = filterQuery.isFetching;
    gridHasNext = !!filterQuery.data?.hasNextPage;
    gridLoadMore = () => setFilterPage(p => p + 1);
  } else if (tab === "latest") {
    gridItems = latestItems;
    gridLoading = latestQuery.isFetching && latestItems.length === 0;
    gridFetching = latestQuery.isFetching;
    gridHasNext = !!latestQuery.data?.hasNextPage;
    gridLoadMore = () => setLatestPage(p => p + 1);
  } else {
    gridItems = popularItems;
    gridLoading = popularQuery.isFetching && popularItems.length === 0;
    gridFetching = popularQuery.isFetching;
    gridHasNext = !!popularQuery.data?.hasNextPage;
    gridLoadMore = () => setPopularPage(p => p + 1);
  }

  const activeTabValue: ActiveTab = inSearchMode ? "filter" : inFilterMode ? "filter" : tab;

  useEffect(() => {
    const onScroll = () => {
      sessionStorage.setItem(pageScrollKey, String(window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pageScrollKey]);

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">

        {/* Title row */}
        <div className="flex items-center gap-3 px-4 h-14">
          <div className="flex-1 min-w-0">
            <h1 className="font-serif font-bold text-lg sm:text-xl truncate leading-tight">{source.name}</h1>
            <p className="text-[11px] text-muted-foreground leading-none mt-0.5">
              {source.lang.toUpperCase()}
              {source.isNsfw && <span className="ml-1.5 text-rose-500">18+</span>}
            </p>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost" size="icon" className="h-9 w-9"
              aria-label="Back"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost" size="icon"
              className={`h-9 w-9 ${searchOpen ? "text-primary" : ""}`}
              aria-label="Search"
              onClick={() => setSearchOpen(o => !o)}
            >
              <Search className="h-5 w-5" />
            </Button>

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

        {/* Search bar */}
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

        {/* Tab bar — hidden when text-searching */}
        {!inSearchMode && (
          <div className="flex flex-col gap-1.5 px-4 pb-3">
            {/* Primary Popular / Latest tabs */}
            <div className="flex items-center gap-1">
            {(["popular", "latest"] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => handleBrowseTab(v)}
                className={`px-4 py-2 text-sm font-medium rounded-full transition-colors whitespace-nowrap capitalize ${
                  activeTabValue === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {v === "popular" ? "Popular" : "Latest"}
              </button>
            ))}

            {availableTags.length > 0 && (
              <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-colors whitespace-nowrap border ${
                      inFilterMode
                        ? "bg-primary text-primary-foreground border-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filter
                    {hasAppliedTags && (
                      <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-background/30 text-[11px] font-bold">
                        {allTagIds.length}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[340px] sm:w-[400px] p-0" sideOffset={8}>
                  <TagPicker
                    tags={availableTags}
                    initialTagState={appliedTagState}
                    onApply={handleApplyFilter}
                    onClearAndClose={() => {
                      setAppliedTagState({});
                      setFilterPopoverOpen(false);
                      setTab("popular");
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}

            {inFilterMode && (
              <button
                type="button"
                onClick={() => { setAppliedTagState({}); setTab("popular"); }}
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" /> Clear filter
              </button>
            )}
            </div>{/* end primary tab row */}

            {/* Sort sub-pills — shown under Popular and Latest tabs when source exposes sort options */}
            {(tab === "popular" || tab === "latest") && !isFiltering && popularSorts.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {popularSorts.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPopularSort(opt.value === popularSort ? null : opt.value)}
                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors whitespace-nowrap ${
                      popularSort === opt.value
                        ? "bg-primary/15 text-primary border-primary/40"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search mode: show active query hint */}
        {inSearchMode && (
          <div className="flex items-center gap-2 px-4 pb-3 text-xs text-muted-foreground">
            <span>Search results for <strong className="text-foreground">"{searchQuery}"</strong></span>
            <button
              type="button"
              onClick={() => { setSearchInput(""); setSearchQuery(""); }}
              className="ml-auto flex items-center gap-1 hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}
      </header>

      {/* VPN / blocked source warning */}
      {isSourceError && (
        <VpnBanner
          sourceId={sourceId}
          coversAvailable={coversAvailable}
          onRetry={() => activeQuery.refetch()}
        />
      )}

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
        {isSourceError && gridItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500" />
            <h2 className="text-lg font-semibold">Couldn't load {source.name}</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              This source may be temporarily unavailable or blocked in your region.
            </p>
            <Button variant="outline" onClick={() => activeQuery.refetch()} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </div>
        ) : (
          <Grid
            items={gridItems}
            loading={gridLoading}
            fetching={gridFetching}
            hasNext={gridHasNext}
            onLoadMore={gridLoadMore}
            sourceId={sourceId}
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
  sourceId?: string;
}

function Grid({ items, loading, fetching, hasNext, onLoadMore, sourceId }: GridProps) {
  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (items.length === 0) {
    return <div className="text-center text-muted-foreground py-20">No titles found.</div>;
  }
  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-5">
        {items.map(m => (
          <MangaCard
            key={m.id}
            manga={m as any}
            sourceId={sourceId}
            href={sourceId ? `/sources/${sourceId}/manga/${m.id}` : undefined}
          />
        ))}
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
// TagPicker
// ---------------------------------------------------------------------------
interface TagPickerProps {
  tags: SourceTag[];
  initialTagState: Record<string, TagTriState>;
  onApply: (state: Record<string, TagTriState>) => void;
  onClearAndClose: () => void;
}

function TagPicker({ tags, initialTagState, onApply, onClearAndClose }: TagPickerProps) {
  const [pending, setPending] = useState<Record<string, TagTriState>>(() => ({ ...initialTagState }));
  const [tagSearch, setTagSearch] = useState("");

  const prevInitial = useRef(initialTagState);
  useEffect(() => {
    if (prevInitial.current !== initialTagState) {
      prevInitial.current = initialTagState;
      setPending({ ...initialTagState });
    }
  }, [initialTagState]);

  const cycleTag = (id: string) => {
    setPending(prev => {
      const cur = prev[id];
      if (!cur) return { ...prev, [id]: "include" };
      if (cur === "include") return { ...prev, [id]: "exclude" };
      const next = { ...prev }; delete next[id]; return next;
    });
  };

  const grouped = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const map = new Map<string, SourceTag[]>();
    for (const t of tags) {
      if (q && !t.name.toLowerCase().includes(q)) continue;
      const key = t.group ?? "Tags";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [tags, tagSearch]);

  const activeCount = Object.keys(pending).length;

  return (
    <>
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Filter by tag</h4>
          {activeCount > 0 && (
            <button type="button" onClick={() => setPending({})} className="text-xs text-muted-foreground hover:text-foreground">
              Clear all
            </button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Find tag…"
            value={tagSearch}
            onChange={e => setTagSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Check className="h-3 w-3 text-primary" />Include</span>
          <span className="flex items-center gap-1"><X className="h-3 w-3 text-destructive" />Exclude</span>
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
                  const state = pending[t.id];
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => cycleTag(t.id)}
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

      <div className="p-3 border-t flex gap-2">
        {Object.keys(initialTagState).length > 0 && (
          <Button variant="outline" size="sm" className="flex-1" onClick={onClearAndClose}>
            Remove filter
          </Button>
        )}
        <Button
          size="sm"
          className="flex-1"
          onClick={() => onApply(pending)}
          disabled={activeCount === 0}
        >
          Apply{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>
    </>
  );
}
