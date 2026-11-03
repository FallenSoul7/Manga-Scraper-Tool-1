import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { mediaImage } from "@/lib/utils";
import {
  Trash2,
  Loader2,
  ChevronRight,
  X,
  SearchX,
  Settings,
  Pin,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { useStore, storeActions, type InstalledSource } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";
import { hasAdultAccessConsent } from "@/lib/compliance-consent";
import { useOnlineStatus } from "@/lib/offline-catalog";
import { requestBackendRefresh } from "@/components/backend-warmup";
import Tier1ExtensionCatalog from "@/components/tier1-extension-catalog";
import { getClientSourceAdapter } from "@/lib/client-sources";
import { useImportedTier1Extensions } from "@/lib/imported-extensions";
import { useOfficialExtensionRegistry } from "@/lib/extension-registry";

// Prefix relative backend icon paths so <img> loads them from Render.
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const GLOBAL_SEARCH_TIMEOUT_MS = 15_000;
function resolveIconUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") && API_ORIGIN) return `${API_ORIGIN}${url}`;
  return url;
}

const LANG_LABELS: Record<string, string> = {
  all: "Multi", en: "English", ar: "العربية", bg: "Български", ca: "Català",
  cs: "Čeština", de: "Deutsch", es: "Español", fr: "Français",
  id: "Bahasa Indonesia", it: "Italiano", ja: "日本語", ko: "한국어",
  pl: "Polski", pt: "Português", ru: "Русский", th: "ไทย",
  tr: "Türkçe", uk: "Українська", vi: "Tiếng Việt", zh: "中文",
};
const langLabel = (code: string) => LANG_LABELS[code] ?? code.toUpperCase();
const ANIME_SOURCE_IDS = new Set(["en.animegg"]);

// Keep availability labels for previously installed server sources.
const NOT_WORKING_SOURCE_IDS = new Set([
  "en.comix",
  "en.comickfan",
  "en.utoon",
  "en.manhuaplus",
  "en.elftoon",
  "en.onlythebesthentai",
  "en.allmanga",
  "en.allanime",
  "en.animegg",
  "en.ravenscans",
]);
const UPSTREAM_BLOCKED_SOURCE_IDS = new Set(["en.royalroad"]);

function SourceStatusTag({ sourceId, supported = true }: { sourceId: string; supported?: boolean }) {
  if (!supported) return null;
  const notWorking = NOT_WORKING_SOURCE_IDS.has(sourceId);
  const upstreamBlocked = UPSTREAM_BLOCKED_SOURCE_IDS.has(sourceId);
  return (
    <span
      className={upstreamBlocked
        ? "text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 shrink-0"
        : notWorking
        ? "text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shrink-0"
        : "text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0"}
    >
      {upstreamBlocked ? "Blocked upstream" : notWorking ? "Not working" : "Working"}
    </span>
  );
}

const INHERENTLY_MATURE_SOURCE_IDS = new Set([
  "en.ninehentai",
  "all.pawchive",
]);
// Older catalog snapshots incorrectly marked several general catalogues as
// adult-only. These IDs must stay visible even if an installed device still
// has one of those stale flags persisted locally.
const GENERAL_SOURCE_IDS = new Set([
  "all.mangadex", "en.comix", "en.mangafreak", "en.comickfan",
  "en.ravenscans", "en.allmanga", "en.allanime", "all.comicklive",
  "ar.empirewebtoon", "vi.kamicomic", "en.comickiba", "en.nineanime",
  "en.webtoontr", "en.webtoonscan", "en.webtoonxyz",
]);
const isInherentlyMature = (source: { id: string; isNsfw?: boolean }) =>
  !GENERAL_SOURCE_IDS.has(source.id) &&
  (Boolean(source.isNsfw) || INHERENTLY_MATURE_SOURCE_IDS.has(source.id));

// Mirrors Mihon's BrowseIcons defaultModifier: a fixed square icon slot with
// proportional fitting so wide/tall source icons remain fully visible.
function SourceAvatar({ src, size = 40 }: { src: { name: string; iconUrl: string | null }; size?: number }) {
  const [errored, setErrored] = useState(false);
  const resolvedIcon = resolveIconUrl(src.iconUrl);
  const isAnimeGGIcon = /\/source-icons\/en\.animegg\.svg(?:\?|$)/i.test(resolvedIcon ?? "");
  if (resolvedIcon && !errored) {
    return (
      <img
        src={resolvedIcon} alt="" width={size} height={size}
        loading={isAnimeGGIcon ? "eager" : "lazy"}
        fetchPriority={isAnimeGGIcon ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className="shrink-0 object-contain rounded-xl bg-muted/60"
        style={{ width: size, height: size, aspectRatio: "1 / 1" }}
      />
    );
  }
  const initials = src.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded-xl bg-muted/60 text-muted-foreground flex items-center justify-center shrink-0 font-bold border border-border/40"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {initials}
    </div>
  );
}

// ─── Global search results ────────────────────────────────────────────────────
interface GlobalResult { id: string; title: string; thumbnail: string; isNsfw?: boolean }
interface SourceResults { source: InstalledSource; items: GlobalResult[]; loading: boolean }

function GlobalSearchResults({ query, results, isSearching, onClear }: {
  query: string; results: SourceResults[]; isSearching: boolean; onClear: () => void;
}) {
  if (isSearching && results.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Searching all sources for "{query}"…</p>
      </div>
    );
  }
  const withResults = results.filter(r => !r.loading && r.items.length > 0);
  const doneCount = results.filter(r => !r.loading).length;
  return (
    <div className="space-y-1 px-4 pt-3">
      <div className="flex items-center justify-between pb-3">
        <p className="text-sm text-muted-foreground">
          {results.length === 0
            ? <>Searching…</>
            : doneCount < results.length
              ? <>{doneCount} / {results.length} sources searched…</>
              : withResults.length > 0
                ? <>{withResults.length} of {results.length} source{results.length !== 1 ? "s" : ""} returned results for <strong>"{query}"</strong></>
                : <>No results across all sources for <strong>"{query}"</strong></>}
        </p>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onClear}>
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>
      <div className="space-y-7">
        {results.map(({ source, items, loading }) => (
          <div key={source.id}>
            <div className="flex items-center gap-2 mb-3">
              {resolveIconUrl(source.iconUrl)
                ? <img src={resolveIconUrl(source.iconUrl)!} alt="" className="w-5 h-5 rounded bg-muted object-contain p-0.5 shrink-0 aspect-square" referrerPolicy="no-referrer" />
                : <div className="w-5 h-5 rounded bg-muted shrink-0" />}
              <span className="font-semibold text-sm">{source.name}</span>
              {source.isNsfw && <span className="text-[10px] px-1.5 py-0 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold">18+</span>}
              <span className="text-xs text-muted-foreground">{langLabel(source.lang)}</span>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <div className="flex-1" />
              {!loading && (
                <Link href={`/sources/${source.id}?q=${encodeURIComponent(query)}`}>
                  <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                    See more <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              )}
            </div>
            {loading ? (
              <div className="flex items-center gap-2 py-4 px-3 rounded-xl border bg-muted/30 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Searching…
              </div>
            ) : items.length === 0 ? (
              <div className="flex items-center gap-2 py-4 px-3 rounded-xl border bg-muted/30 text-sm text-muted-foreground">
                <SearchX className="h-4 w-4 shrink-0" /> No results from this source
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar">
                {items.map((manga) => (
                  <Link
                    key={manga.id}
                    href={source.id === "all.pawchive"
                      ? `/sources/${source.id}/creator/${encodeURIComponent(manga.id)}`
                      : `/sources/${source.id}/manga/${encodeURIComponent(manga.id)}`}
                  >
                    <div className="shrink-0 w-24 sm:w-28 cursor-pointer group">
                      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-muted mb-1.5 shadow-sm">
                        <img
                          src={mediaImage(manga.thumbnail, source.id)} alt={manga.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <p className="text-xs font-medium line-clamp-2 leading-snug group-hover:text-primary transition-colors px-0.5">
                        {manga.title}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SourcesPage() {
  const online = useOnlineStatus();
  const { data: backendReady = false } = useQuery<boolean>({
    queryKey: ["backend-ready"],
    queryFn: async () => false,
    initialData: false,
    staleTime: Infinity,
    enabled: false,
  });
  const installedMap = useStore(s => s.installedSources);
  const importedExtensions = useImportedTier1Extensions();
  const extensionRegistry = useOfficialExtensionRegistry();
  const activeId     = useStore(s => s.activeSourceId);
  const { settings } = useSettings();
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const installed = useMemo(
    () => Object.values(installedMap)
      .filter(source => !isInherentlyMature(source) || (!settings.hideNsfw && hasAdultAccessConsent()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [installedMap, settings.hideNsfw],
  );

  const urlQ = new URLSearchParams(searchString).get("q") ?? "";
  const [globalResults, setGlobalResults] = useState<SourceResults[]>([]);
  const [isSearching, setIsSearching]     = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");

  useEffect(() => {
    if (!online) {
      setGlobalResults([]);
      setIsSearching(false);
      return;
    }
    if (!urlQ) { setGlobalResults([]); setSearchedQuery(""); return; }
    const hasClientOnlySource = installed.some(source => getClientSourceAdapter(source.id)?.fallbackToServer === false);
    if (!backendReady && !hasClientOnlySource) {
      setGlobalResults([]);
      setSearchedQuery("");
      setIsSearching(true);
      return;
    }
    const resultsMatchInstalledSources = installed.length === globalResults.length &&
      installed.every(source => globalResults.some(result => result.source.id === source.id));
    if (urlQ === searchedQuery && globalResults.length > 0 && resultsMatchInstalledSources) return;
    setIsSearching(true);
    setSearchedQuery(urlQ);

    // Initialize all sources as loading
    const initial: SourceResults[] = installed.map(src => ({
      source: src,
      items: [],
      loading: backendReady || getClientSourceAdapter(src.id)?.fallbackToServer === false,
    }));
    setGlobalResults(initial);

    // Fetch each source individually and update as results arrive. A blocked
    // extension must not leave the global search spinner running forever.
    const controllers = new Set<AbortController>();
    installed.forEach(async (src) => {
      const adapter = getClientSourceAdapter(src.id);
      if (!backendReady && adapter?.fallbackToServer !== false) {
        setGlobalResults(prev => prev.map(r => r.source.id === src.id ? { ...r, items: [], loading: false } : r));
        return;
      }
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), GLOBAL_SEARCH_TIMEOUT_MS);
      try {
        let items: SourceResults["items"];
        if (adapter?.fallbackToServer === false) {
          items = (await adapter.search(urlQ, 1)).items.slice(0, 12);
        } else {
          const res = await fetch(`${API_ORIGIN}/api/search?query=${encodeURIComponent(urlQ)}&page=1`, {
            headers: { "X-Source": src.id },
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Source returned ${res.status}`);
          const data = await res.json();
          items = (data.items ?? []).slice(0, 12);
        }
        setGlobalResults(prev => prev.map(r => r.source.id === src.id ? { ...r, items, loading: false } : r));
      } catch {
        setGlobalResults(prev => prev.map(r => r.source.id === src.id ? { ...r, items: [], loading: false } : r));
      } finally {
        window.clearTimeout(timeout);
        controllers.delete(controller);
      }
    });

    setIsSearching(false);
    return () => controllers.forEach(controller => controller.abort());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ, online, backendReady, installed]);

  const clearSearch = () => { setLocation("/sources"); setGlobalResults([]); setSearchedQuery(""); };
  const showGlobalSearch = !!(urlQ || isSearching || globalResults.length > 0);

  const extensionCount = (extensionRegistry?.extensions.length ?? 0) + importedExtensions.length;

  return (
    <main className="pb-8 max-w-3xl mx-auto">
      {online && !backendReady && (
        <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-primary/15 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span className="flex-1">Connecting to the content service…</span>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={requestBackendRefresh} aria-label="Refresh content service connection">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      )}
      {showGlobalSearch && !online ? (
        <div className="px-4 py-20 text-center">
          <WifiOff className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-4 text-sm font-medium">Global source search is unavailable offline</p>
          <p className="mt-1 text-xs text-muted-foreground">Your installed sources remain available.</p>
          <Button variant="outline" size="sm" className="mt-5" onClick={() => setLocation("/sources")}>View installed sources</Button>
        </div>
      ) : showGlobalSearch ? (
        <GlobalSearchResults
          query={urlQ || searchedQuery}
          results={globalResults}
          isSearching={isSearching}
          onClear={clearSearch}
        />
      ) : (
        <Tabs defaultValue="sources" className="w-full">
          {/* Tab bar */}
          <div className="sticky top-0 z-10 bg-background border-b border-border/50">
            <TabsList className="w-full rounded-none bg-transparent h-12 px-0 gap-0 justify-start">
              <TabsTrigger
                value="sources"
                className="rounded-none h-12 px-5 text-sm font-medium data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground bg-transparent shadow-none"
              >
                Sources
              </TabsTrigger>
              <TabsTrigger
                value="extensions"
                className="rounded-none h-12 px-5 text-sm font-medium data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground bg-transparent shadow-none flex items-center gap-1.5"
              >
                Extensions
                {extensionCount > 0 && (
                  <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                    {extensionCount > 99 ? "99+" : extensionCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="anime"
                className="rounded-none h-12 px-5 text-sm font-medium data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground bg-transparent shadow-none"
              >
                Anime
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="sources" className="mt-0 animate-in fade-in duration-300">
            <SourcesTab installed={installed} activeId={activeId} />
          </TabsContent>

          <TabsContent value="anime" className="mt-0 animate-in fade-in duration-300">
            <AnimeTab installed={installed} />
          </TabsContent>

          <TabsContent value="extensions" className="mt-0 animate-in fade-in duration-300">
            <Tier1ExtensionCatalog />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

// ─── Sources tab (Tachiyomi-style) ───────────────────────────────────────────
function SourcesTab({ installed, activeId }: { installed: InstalledSource[]; activeId: string }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { settings, updateSettings } = useSettings();
  const [settingsSource, setSettingsSource] = useState<InstalledSource | null>(null);

  const withIcon = useMemo(
    () => installed.map(s => ({
      ...s,
      iconUrl: s.iconUrl ?? null,
      isNsfw: isInherentlyMature(s),
    })),
    [installed],
  );

  const sourceSort = (a: InstalledSource, b: InstalledSource) => {
    const workingDelta = Number(NOT_WORKING_SOURCE_IDS.has(a.id)) - Number(NOT_WORKING_SOURCE_IDS.has(b.id));
    return workingDelta || a.name.localeCompare(b.name);
  };
  const pinnedSources = withIcon.filter(s => s.isPinned).sort(sourceSort);
  const lastUsed      = withIcon.find(s => s.id === activeId && !s.isPinned);
  const rest          = withIcon.filter(s => !s.isPinned && s.id !== activeId).sort(sourceSort);

  function SourceRow({ src }: { src: InstalledSource }) {
    const isPinned = !!src.isPinned;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => { storeActions.setActiveSource(src.id); setLocation(`/sources/${src.id}`); }}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); storeActions.setActiveSource(src.id); setLocation(`/sources/${src.id}`); } }}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 active:bg-muted/60 transition-colors"
      >
        <SourceAvatar src={src} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-foreground truncate">{src.name}</p>
            <SourceStatusTag sourceId={src.id} supported={!src.id.startsWith("tier1.")} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{langLabel(src.lang)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          {!isInherentlyMature(src) && (
            <button
              className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title={`${src.name} settings`}
              aria-label={`${src.name} settings`}
              onClick={() => setSettingsSource(src)}
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          <button
            className={`h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors ${isPinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
            title={isPinned ? "Unpin" : "Pin"}
            onClick={() => storeActions.togglePinSource(src.id)}
          >
            <Pin className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
          </button>
          <button
            className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
            title="Remove"
            onClick={() => { storeActions.uninstallSource(src.id); toast({ title: `Removed ${src.name}` }); }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (installed.length === 0) {
    return (
      <div className="py-20 text-center text-muted-foreground text-sm px-6">
        <p className="mb-1">No sources installed.</p>
        <p>Open the <strong>Extensions</strong> tab to add sources.</p>
      </div>
    );
  }

  return (
    <div>
      {pinnedSources.length > 0 && (
        <>
          <div className="px-4 pt-5 pb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pinned</p>
          </div>
          {pinnedSources.map(src => <SourceRow key={src.id} src={src} />)}
        </>
      )}
      {lastUsed && (
        <>
          <div className="px-4 pt-5 pb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last used</p>
          </div>
          <SourceRow src={lastUsed} />
        </>
      )}
      {rest.length > 0 && (
        <>
          <div className="px-4 pt-5 pb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">All sources</p>
          </div>
          {rest.map(src => <SourceRow key={src.id} src={src} />)}
        </>
      )}
      <Dialog open={!!settingsSource} onOpenChange={open => { if (!open) setSettingsSource(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{settingsSource?.name} settings</DialogTitle>
            <DialogDescription>Settings for this source.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
            <div className="space-y-1">
              <Label htmlFor="extension-hide-mature" className="font-medium">Hide mature content</Label>
              <p className="text-xs text-muted-foreground">Hide 18+ manga from this extension by default.</p>
            </div>
            <Switch
              id="extension-hide-mature"
              checked={settings.hideNsfw}
              onCheckedChange={hideNsfw => updateSettings({ hideNsfw })}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Anime tab ────────────────────────────────────────────────────────────────
function AnimeTab({ installed }: { installed: InstalledSource[] }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const adultAccess = !settings.hideNsfw && hasAdultAccessConsent();

  const animeSources = useMemo(
    () => installed
      .filter(s => ANIME_SOURCE_IDS.has(s.id))
      .filter(s => !s.isNsfw || adultAccess)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [installed, adultAccess],
  );

  function AnimeRow({ src }: { src: InstalledSource }) {
    const isPinned = !!src.isPinned;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => { storeActions.setActiveSource(src.id); setLocation(`/sources/${src.id}`); }}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); storeActions.setActiveSource(src.id); setLocation(`/sources/${src.id}`); } }}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 active:bg-muted/60 transition-colors"
      >
        <SourceAvatar src={src} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-foreground truncate">{src.name}</p>
            {src.isNsfw && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 border border-red-500/25 shrink-0">18+</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Anime · Video</p>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            className={`h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors ${isPinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
            title={isPinned ? "Unpin" : "Pin"}
            onClick={() => storeActions.togglePinSource(src.id)}
          >
            <Pin className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
          </button>
          <button
            className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
            title="Remove"
            onClick={() => { storeActions.uninstallSource(src.id); toast({ title: `Removed ${src.name}` }); }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Installed anime sources */}
      {animeSources.length > 0 && (
        <>
          <div className="px-4 pt-5 pb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Installed</p>
          </div>
          {animeSources.map(src => <AnimeRow key={src.id} src={src} />)}
        </>
      )}

      {animeSources.length === 0 && (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">No anime sources installed.</div>
      )}
    </div>
  );
}
