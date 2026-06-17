import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRoute, useSearch, useLocation } from "wouter";
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
// VPN / Blocked-source banner (unchanged)
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
  const [, setLocation] = useLocation();
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

  // Unified source info
  const source = installedSource ?? (catalogEntry ? {
    id: sourceId,
    name: catalogEntry.name,
    lang: catalogEntry.lang,
    isNsfw: catalogEntry.isNsfw,
  } : null);

  const popularSorts: PopularSortOption[] = catalogEntry?.popularSorts ?? [];

  // ---- Active tab & search state ----
  const pageStateKey = `source-state:${sourceId}`;
  const pageScrollKey = `source-scroll:${sourceId}`;

  const storedSnapshot = useMemo<PageSnapshot | null>(() => {
    if (urlQ || urlTagId) return null;
    try {
      const raw = sessionStorage.getItem(pageStateKey);
      if (!raw) return null;
      return JSON.parse(raw) as PageSnapshot;
    } catch {
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only run once on mount

  // ---- State initialisation (from snapshot or fresh) ----
  const [tab, setTab] = useState<ActiveTab>(() =>
    storedSnapshot ? storedSnapshot.tab : urlTagId ? "filter" : "popular"
  );
  const [popularSort, setPopularSort] = useState<string | null>(
    () => storedSnapshot?.popularSort ?? null
  );
  const [searchOpen, setSearchOpen] = useState(
    () => storedSnapshot ? storedSnapshot.searchOpen : !!urlQ
  );
  const [searchInput, setSearchInput] = useState(
    () => storedSnapshot?.searchInput ?? urlQ
  );
  const [searchQuery, setSearchQuery] = useState(
    () => storedSnapshot?.searchQuery ?? urlQ
  );

  const isFirstMountRef = useRef(true);

  const [appliedTagState, setAppliedTagState] = useState<Record<string, TagTriState>>(
    () => storedSnapshot?.appliedTagState ?? (urlTagId ? { [urlTagId]: "include" } : {}),
  );
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── NEW: scroll restoration helper ──────────────────────
  const scrollRestoreY = useRef<number | null>(storedSnapshot?.scrollY ?? null);
  const hasRestoredScroll = useRef(false);

  // ---- Pagination ----
  const [popularPage, setPopularPage] = useState(() => storedSnapshot?.popularPage ?? 1);
  const [popularItems, setPopularItems] = useState<MangaSummary[]>(() => storedSnapshot?.popularItems ?? []);
  const [latestPage, setLatestPage] = useState(() => storedSnapshot?.latestPage ?? 1);
  const [latestItems, setLatestItems] = useState<MangaSummary[]>(() => storedSnapshot?.latestItems ?? []);
  const [filterPage, setFilterPage] = useState(() => storedSnapshot?.filterPage ?? 1);
  const [filterItems, setFilterItems] = useState<MangaSummary[]>(() => storedSnapshot?.filterItems ?? []);

  // Always set source header
  useEffect(() => {
    if (!sourceId) return;
    applyActiveSource(sourceId);
    if (installedSource) storeActions.setActiveSource(sourceId);
  }, [sourceId, installedSource]);

  // Reset state on source change (skip first mount)
  useEffect(() => {
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

  // Reset pagination when sort changes
  useEffect(() => {
    setPopularPage(1); setPopularItems([]);
    setLatestPage(1); setLatestItems([]);
  }, [popularSort]);

  // Debounce search
  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(searchInput.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const appliedTagKey = JSON.stringify(appliedTagState);
  useEffect(() => { setFilterPage(1); setFilterItems([]); }, [searchQuery, appliedTagKey]);

  // Derived tag lists
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

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
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

  // Accumulate paginated results
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

  // VPN error banner logic
  const activeQuery = isFiltering ? filterQuery : tab === "latest" ? latestQuery : popularQuery;
  const isSourceError = activeQuery.isError;
  const coversAvailable = !isSourceError && (popularItems.length > 0 || popularQuery.isSuccess);

  // Save snapshot for back navigation
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
    try { sessionStorage.setItem(pageStateKey, JSON.stringify(snapshot)); } catch { /* quota */ }
    sessionStorage.setItem(pageScrollKey, String(window.scrollY));
  }, [
    pageStateKey, pageScrollKey,
    tab, popularSort, searchOpen, searchInput, searchQuery, appliedTagState,
    popularPage, latestPage, filterPage, popularItems, latestItems, filterItems,
  ]);

  // ═══════════════════════════════════════════════════════
  //  SCROLL RESTORATION (improved)
  // ═══════════════════════════════════════════════════════
  // We restore the scroll position *after* the grid items have been set from
  // the snapshot and the DOM has settled. The items state is already initialised
  // synchronously from the snapshot, so we only need a small delay.
  const activeGridItems = useMemo(() => {
    if (isFiltering) return filterItems;
    if (tab === "latest") return latestItems;
    return popularItems;
  }, [isFiltering, tab, filterItems, latestItems, popularItems]);

  useEffect(() => {
    if (hasRestoredScroll.current) return;
    if (scrollRestoreY.current == null || scrollRestoreY.current <= 0) return;
    if (activeGridItems.length === 0) return; // wait until we have items

    const targetY = scrollRestoreY.current;
    // Multiple attempts because images may still load and shift layout
    const attemptRestore = (attempt: number) => {
      window.scrollTo({ top: targetY, behavior: "instant" });
      if (attempt < 3) {
        setTimeout(() => attemptRestore(attempt + 1), 200);
      } else {
        scrollRestoreY.current = null;
        hasRestoredScroll.current = true;
      }
    };
    // Start after a tiny delay to let React commit the DOM
    const timeout = setTimeout(() => attemptRestore(0), 100);
    return () => clearTimeout(timeout);
  }, [activeGridItems]); // re-run when active grid items change (e.g. tab switch)

  // Continuous scroll tracking (unchanged)
  useEffect(() => {
    const onScroll = () => {
      sessionStorage.setItem(pageScrollKey, String(window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pageScrollKey]);

  // ---- Render ----
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
        <Button variant="outline" onClick={() => setLocation("/sources")}>Go back</Button>
      </div>
    );
  }

  // Decide what grid to show
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

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Sticky header (identical) ──────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* ... the entire header JSX stays exactly as you had it ... */}
        {/* I'm omitting the full header markup to save space, but it's unchanged. */}
      </header>

      {/* VPN banner */}
      {isSourceError && (
        <VpnBanner
          sourceId={sourceId}
          coversAvailable={coversAvailable}
          onRetry={() => activeQuery.refetch()}
        />
      )}

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 container mx-auto px-4 py-3 max-w-7xl">
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
// Grid (unchanged)
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
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasNext && !fetching) onLoadMore(); },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNext, fetching, onLoadMore]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (items.length === 0) {
    return <div className="text-center text-muted-foreground py-20">No titles found.</div>;
  }
  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3">
        {items.map(m => (
          <MangaCard
            key={m.id}
            manga={m as any}
            sourceId={sourceId}
            href={sourceId ? `/sources/${sourceId}/manga/${m.id}` : undefined}
          />
        ))}
      </div>
      <div ref={sentinelRef} className="h-1 w-full mt-4" aria-hidden />
      {fetching && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// TagPicker (unchanged)
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
