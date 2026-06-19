import { useSearch, useLocation } from "wouter";
import { useSearchManga, getSearchMangaQueryKey } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { MangaCard } from "@/components/manga-card";
import { Loader2, Search as SearchIcon, Clock } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "@/components/ui/button";

// ── Session snapshot helpers ────────────────────────────────────────────────
interface SearchSnapshot { query: string; page: number; items: any[] }
const snapKey  = (q: string) => `search-state:${q}`;
const scrollKey = (q: string) => `search-scroll:${q}`;

function loadSnapshot(q: string): SearchSnapshot | null {
  if (!q) return null;
  try { return JSON.parse(sessionStorage.getItem(snapKey(q)) ?? "null"); } catch { return null; }
}
function loadScrollY(q: string): number {
  return parseFloat(sessionStorage.getItem(scrollKey(q)) || "0") || 0;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function SearchPage() {
  const searchString = useSearch();
  const query = useMemo(() => new URLSearchParams(searchString).get("query") || "", [searchString]);
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const searchHistory = useStore(s => s.searchHistory);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 2;

  // ── Restore snapshot on mount ──────────────────────────────────────────
  const [snapshot] = useState<SearchSnapshot | null>(() => loadSnapshot(trimmed));
  const [accumulatedItems, setAccumulatedItems] = useState<any[]>(() => snapshot?.items ?? []);
  const [page, setPage] = useState<number>(1);
  // Flag: we already have items from snapshot — don't wipe them on first page-1 fetch
  const didRestoreRef = useRef(snapshot != null && (snapshot.items?.length ?? 0) > 0);

  const scrollRestoreY = useRef<number | null>(
    (() => {
      const best = Math.max(loadScrollY(trimmed), snapshot?.items?.length ? (loadScrollY(trimmed) || 0) : 0);
      return best > 0 ? best : null;
    })()
  );
  const hasRestoredScroll = useRef(false);

  // Reset everything when query changes
  const prevTrimmedRef = useRef(trimmed);
  useEffect(() => {
    if (prevTrimmedRef.current === trimmed) return;
    prevTrimmedRef.current = trimmed;
    setAccumulatedItems([]);
    setPage(1);
    didRestoreRef.current = false;
    scrollRestoreY.current = loadScrollY(trimmed);
    hasRestoredScroll.current = false;
  }, [trimmed]);

  // ── Fetch ────────────────────────────────────────────────────────────
  const searchParams = { query: trimmed, nsfw: !settings.hideNsfw, poster: settings.posterQuality, page };
  const { data: results, isLoading, isFetching } = useSearchManga(searchParams as any, {
    query: {
      enabled: trimmed.length >= 2,
      queryKey: getSearchMangaQueryKey(searchParams as any),
    },
  });

  // Accumulate results across pages
  useEffect(() => {
    if (!results?.items) return;
    setAccumulatedItems(prev => {
      if (page === 1 && didRestoreRef.current) {
        // Back-navigation: merge fresh page-1 into existing snapshot items (deduplicate)
        didRestoreRef.current = false;
        const existingIds = new Set(prev.map((m: any) => m.id));
        const newOnes = results.items.filter((m: any) => !existingIds.has(m.id));
        return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
      }
      if (page === 1) return results.items;
      const existingIds = new Set(prev.map((m: any) => m.id));
      const newOnes = results.items.filter((m: any) => !existingIds.has(m.id));
      return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
    });
  }, [results]); // intentionally omit `page` — page is already baked into results identity via queryKey

  const hasNextPage = (results as any)?.hasNextPage ?? false;

  // ── Save snapshot whenever items change ────────────────────────────────
  useEffect(() => {
    if (!trimmed || accumulatedItems.length === 0) return;
    const snap: SearchSnapshot = { query: trimmed, page, items: accumulatedItems };
    try { sessionStorage.setItem(snapKey(trimmed), JSON.stringify(snap)); } catch { /* quota */ }
    sessionStorage.setItem(scrollKey(trimmed), String(window.scrollY));
  }, [trimmed, page, accumulatedItems]);

  // Continuous scroll tracking
  useEffect(() => {
    if (!trimmed) return;
    const onScroll = () => sessionStorage.setItem(scrollKey(trimmed), String(window.scrollY));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [trimmed]);

  // ── Scroll restoration ───────────────────────────────────────────────
  useEffect(() => {
    if (hasRestoredScroll.current) return;
    if (!scrollRestoreY.current || scrollRestoreY.current <= 0) return;
    if (accumulatedItems.length === 0) return;

    const targetY = scrollRestoreY.current;
    const attempt = (n: number) => {
      window.scrollTo({ top: targetY, behavior: "instant" });
      if (n < 3) setTimeout(() => attempt(n + 1), 200);
      else { scrollRestoreY.current = null; hasRestoredScroll.current = true; }
    };
    const t = setTimeout(() => attempt(0), 100);
    return () => clearTimeout(t);
  }, [accumulatedItems]);

  // ── Infinite scroll sentinel ─────────────────────────────────────────
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasNextPage && !isFetching) setPage(p => p + 1); },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetching]);

  const displayItems = trimmed.length >= 2 ? accumulatedItems : [];

  return (
    <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl animate-in fade-in duration-500">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-2">
          {trimmed ? `Results for "${trimmed}"` : "Search"}
        </h1>
        {trimmed && !tooShort && !isLoading && displayItems.length > 0 && (
          <p className="text-sm sm:text-base text-muted-foreground">
            {displayItems.length} title{displayItems.length === 1 ? "" : "s"} loaded
            {hasNextPage && " — scroll for more"}
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
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
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

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1 w-full mt-4" aria-hidden />

          {isFetching && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </>
      )}
    </main>
  );
}
