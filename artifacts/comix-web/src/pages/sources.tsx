import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { proxyImage } from "@/lib/utils";
import {
  Search,
  CheckCircle2,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  SearchX,
  Settings2,
  Pin,
  AlertCircle,
} from "lucide-react";
import { useStore, storeActions, type InstalledSource } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";

interface CatalogExtension {
  id: string; slug: string; name: string; lang: string;
  isNsfw: boolean; versionCode: number; iconUrl: string | null; supported: boolean;
}
interface CatalogResponse {
  generatedAt: number; count: number; supportedIds: string[]; extensions: CatalogExtension[];
}

// Prefix relative /api/... paths with the Render backend origin so that
// <img> tags (which don't go through customFetch) load from the right host.
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
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
const ALLMANGA_SOURCE_ID = "en.allanime";
const ANIME_SOURCE_IDS = new Set(["video.hentaiyoga", ALLMANGA_SOURCE_ID]);

// Implemented (supported) sources that are intentionally hidden from the
// default Extensions list. They are still installable — but only when found
// through the search box, so they don't sit at the top of the browse list.
const HIDDEN_FROM_DEFAULT_BROWSE = new Set([
  "en.ninehentai",        // NineHentai
  "all.danbooru",         // Danbooru
  "local.koofr",          // K-Cafe
  "en.mangafreak",        // Mangafreak
  "all.hentaifox",        // HentaiFox
  "en.onlythebesthentai", // Only The Best Hentai
  "en.rule34",            // Rule34
]);

function SourceAvatar({ src, size = 44 }: { src: { name: string; iconUrl: string | null }; size?: number }) {
  const [errored, setErrored] = useState(false);
  const resolvedIcon = resolveIconUrl(src.iconUrl);
  if (resolvedIcon && !errored) {
    return (
      <img
        src={resolvedIcon} alt="" width={size} height={size} loading="lazy"
        onError={() => setErrored(true)}
        className="rounded-xl bg-muted shrink-0 object-cover"
        style={{ width: size, height: size }}
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
                ? <img src={resolveIconUrl(source.iconUrl)!} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
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
                  <Link key={manga.id} href={`/sources/${source.id}/manga/${manga.id}`}>
                    <div className="shrink-0 w-24 sm:w-28 cursor-pointer group">
                      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-muted mb-1.5 shadow-sm">
                        <img
                          src={proxyImage(manga.thumbnail, source.id)} alt={manga.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
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
  const installedMap = useStore(s => s.installedSources);
  const activeId     = useStore(s => s.activeSourceId);
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const installed = useMemo(
    () => Object.values(installedMap).sort((a, b) => a.name.localeCompare(b.name)),
    [installedMap],
  );

  const urlQ = new URLSearchParams(searchString).get("q") ?? "";
  const [globalResults, setGlobalResults] = useState<SourceResults[]>([]);
  const [isSearching, setIsSearching]     = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");

  useEffect(() => {
    if (!urlQ) { setGlobalResults([]); setSearchedQuery(""); return; }
    if (urlQ === searchedQuery && globalResults.length > 0) return;
    setIsSearching(true);
    setSearchedQuery(urlQ);

    // Initialize all sources as loading
    const initial: SourceResults[] = installed.map(src => ({ source: src, items: [], loading: true }));
    setGlobalResults(initial);

    // Fetch each source individually and update as results arrive
    installed.forEach(async (src) => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/search?query=${encodeURIComponent(urlQ)}&page=1`, { headers: { "X-Source": src.id } });
        const data = await res.json();
        const items = (data.items ?? []).slice(0, 12);
        setGlobalResults(prev => prev.map(r => r.source.id === src.id ? { ...r, items, loading: false } : r));
      } catch {
        setGlobalResults(prev => prev.map(r => r.source.id === src.id ? { ...r, items: [], loading: false } : r));
      }
    });

    setIsSearching(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  const clearSearch = () => { setLocation("/sources"); setGlobalResults([]); setSearchedQuery(""); };
  const showGlobalSearch = !!(urlQ || isSearching || globalResults.length > 0);

  const { data: catalog } = useQuery<CatalogResponse>({
    queryKey: ["sources-catalog"],
    queryFn: () => customFetch<CatalogResponse>("/api/sources/catalog"),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const extensionCount = catalog?.count ?? 0;

  return (
    <main className="pb-8 max-w-3xl mx-auto">
      {showGlobalSearch ? (
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
            <SourcesTab installed={installed} activeId={activeId} catalog={catalog ?? null} />
          </TabsContent>

          <TabsContent value="anime" className="mt-0 animate-in fade-in duration-300">
            <AnimeTab installed={installed} activeId={activeId} catalog={catalog ?? null} />
          </TabsContent>

          <TabsContent value="extensions" className="mt-0 animate-in fade-in duration-300">
            <BrowseTab installedMap={installedMap} catalog={catalog ?? null} />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

// ─── Sources tab (Tachiyomi-style) ───────────────────────────────────────────
function SourcesTab({ installed, activeId, catalog }: { installed: InstalledSource[]; activeId: string; catalog: CatalogResponse | null }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const catalogIconMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const ext of catalog?.extensions ?? []) {
      map[ext.id] = ext.iconUrl;
    }
    return map;
  }, [catalog]);

  const withIcon = useMemo(
    () => installed.map(s => ({ ...s, iconUrl: s.iconUrl ?? catalogIconMap[s.id] ?? null })),
    [installed, catalogIconMap],
  );

  const pinnedSources = withIcon.filter(s => s.isPinned).sort((a, b) => a.name.localeCompare(b.name));
  const lastUsed      = withIcon.find(s => s.id === activeId && !s.isPinned);
  const rest          = withIcon.filter(s => !s.isPinned && s.id !== activeId).sort((a, b) => a.name.localeCompare(b.name));

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
        <SourceAvatar src={src} size={44} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-foreground truncate">{src.name}</p>
            {(src.id === "en.comix" || src.id === "en.ninehentai") && (
              <span className="text-[11px] font-semibold text-emerald-500 shrink-0">Working</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{langLabel(src.lang)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Settings">
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            className={`h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors ${isPinned ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
            title={isPinned ? "Unpin" : "Pin"}
            onClick={() => storeActions.togglePinSource(src.id)}
          >
            <Pin className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
          </button>
          {src.id !== "en.comix" ? (
            <button
              className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
              title="Remove"
              onClick={() => { storeActions.uninstallSource(src.id); toast({ title: `Removed ${src.name}` }); }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <button className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground opacity-40" disabled title="Info">
              <AlertCircle className="h-4 w-4" />
            </button>
          )}
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
    </div>
  );
}

// ─── Anime tab ────────────────────────────────────────────────────────────────
function AnimeTab({ installed, catalog }: { installed: InstalledSource[]; activeId: string; catalog: CatalogResponse | null }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const catalogIconMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const ext of catalog?.extensions ?? []) map[ext.id] = ext.iconUrl;
    return map;
  }, [catalog]);

  const animeSources = useMemo(
    () => installed
      .filter(s => ANIME_SOURCE_IDS.has(s.id))
      .map(s => ({ ...s, iconUrl: s.iconUrl ?? catalogIconMap[s.id] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [installed, catalogIconMap],
  );

  function AnimeRow({ src }: { src: InstalledSource }) {
    const isPinned = !!src.isPinned;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => { storeActions.setActiveSource(src.id); setLocation(`/sources/${src.id}${src.id === ALLMANGA_SOURCE_ID ? "?media=anime" : ""}`); }}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); storeActions.setActiveSource(src.id); setLocation(`/sources/${src.id}${src.id === ALLMANGA_SOURCE_ID ? "?media=anime" : ""}`); } }}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 active:bg-muted/60 transition-colors"
      >
        <SourceAvatar src={src} size={44} />
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

  const allMangaCatalogEntry = catalog?.extensions.find(e => e.id === ALLMANGA_SOURCE_ID);

  // Hardcoded discoverable anime extensions (always visible for install)
  const ANIME_EXTENSIONS = [
    {
      id: "video.hentaiyoga",
      name: "Hentai Yoga",
      lang: "en",
      isNsfw: true,
      description: "Hentai anime videos",
      iconUrl: null,
      supported: true,
    },
    {
      id: ALLMANGA_SOURCE_ID,
      name: allMangaCatalogEntry?.name ?? "AllManga",
      lang: allMangaCatalogEntry?.lang ?? "en",
      isNsfw: allMangaCatalogEntry?.isNsfw ?? true,
      description: "Manga and anime catalog",
      iconUrl: allMangaCatalogEntry?.iconUrl ?? null,
      supported: allMangaCatalogEntry?.supported ?? false,
    },
  ];

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

      {/* Discoverable anime extensions */}
      <div className="px-4 pt-5 pb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available Extensions</p>
      </div>
      {ANIME_EXTENSIONS.map(ext => {
        const isInstalled = animeSources.some(s => s.id === ext.id);
        return (
          <div key={ext.id} className="flex items-center gap-3 px-4 py-3">
            <SourceAvatar src={{ name: ext.name, iconUrl: ext.iconUrl }} size={44} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm text-foreground truncate">{ext.name}</p>
                {ext.isNsfw && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 border border-red-500/25 shrink-0">18+</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{langLabel(ext.lang)} · Anime · Video</p>
            </div>
            <div className="shrink-0">
              {isInstalled ? (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Installed
                </span>
              ) : !ext.supported ? (
                <span className="text-xs text-muted-foreground">Coming soon</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs px-3 gap-1.5"
                  onClick={() => {
                    storeActions.installSource({ id: ext.id, name: ext.name, lang: ext.lang, isNsfw: ext.isNsfw, iconUrl: ext.iconUrl, isPinned: false });
                    toast({ title: `Installed ${ext.name}` });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Install
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Extensions tab ───────────────────────────────────────────────────────────
const SUPPORTED_FIRST = (a: CatalogExtension, b: CatalogExtension) =>
  Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name);
const PAGE_SIZE = 60;

function BrowseTab({ installedMap, catalog }: { installedMap: Record<string, InstalledSource>; catalog: CatalogResponse | null }) {
  const { toast } = useToast();

  const [search, setSearch]               = useState("");
  const [lang, setLang]                   = useState<string>("all-langs");
  const [showNsfw, setShowNsfw]           = useState(false);
  const [supportedOnly, setSupportedOnly] = useState(false);
  const [visibleCount, setVisibleCount]   = useState(PAGE_SIZE);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, lang, showNsfw, supportedOnly]);

  const allLangs = useMemo(() => {
    if (!catalog) return [] as string[];
    const set = new Set<string>();
    for (const e of catalog.extensions ?? []) set.add(e.lang);
    return Array.from(set).sort();
  }, [catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return (catalog.extensions ?? [])
      .filter(e => lang === "all-langs" ? true : e.lang === lang)
      // AllManga is intentionally discoverable in the normal Extensions tab
      // as well as the Anime tab. Keep its 18+ badge, but do not hide it behind
      // the opt-in NSFW filter.
      .filter(e => showNsfw || !e.isNsfw || e.id === ALLMANGA_SOURCE_ID)
      .filter(e => supportedOnly ? e.supported : true)
      // Keep the curated "hidden" sources out of the default list; they only
      // show up once the user is actively searching for them.
      .filter(e => q ? true : !HIDDEN_FROM_DEFAULT_BROWSE.has(e.id))
      .filter(e => q ? e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q) : true)
      .sort(SUPPORTED_FIRST);
  }, [catalog, search, lang, showNsfw, supportedOnly]);

  const visible = filtered.slice(0, visibleCount);

  if (!catalog) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <div className="px-4 pt-4 pb-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search extensions…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={lang} onChange={e => setLang(e.target.value)}
            className="h-8 px-2 rounded-md border border-input bg-background text-xs flex-1 min-w-[120px]">
            <option value="all-langs">All languages</option>
            {allLangs.map(l => <option key={l} value={l}>{langLabel(l)}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-input bg-background cursor-pointer shrink-0">
            <input type="checkbox" checked={supportedOnly} onChange={e => setSupportedOnly(e.target.checked)} className="rounded" />
            Available
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs px-3 h-8 rounded-md border border-input bg-background cursor-pointer shrink-0">
            <input type="checkbox" checked={showNsfw} onChange={e => setShowNsfw(e.target.checked)} className="rounded" />
            18+
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()}</p>
      </div>

      <div className="divide-y divide-border/40">
        {visible.map(ext => {
          const isInstalled = !!installedMap[ext.id];
          return (
            <div key={ext.id} className="flex items-center gap-3 px-4 py-3">
              <SourceAvatar src={ext} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-sm truncate">{ext.name}</span>
                  {ext.isNsfw && <span className="text-[10px] px-1.5 py-0 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">18+</span>}
                  {!ext.supported && <span className="text-[10px] px-1.5 py-0 rounded bg-muted text-muted-foreground">Coming soon</span>}
                </div>
                <p className="text-xs text-muted-foreground">{langLabel(ext.lang)}</p>
              </div>
              {isInstalled ? (
                <span className="inline-flex items-center gap-1 text-xs text-primary px-1">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
              ) : (
                <Button
                  size="sm" variant={ext.supported ? "default" : "outline"}
                  disabled={!ext.supported} className="h-8 text-xs px-3 shrink-0"
                  onClick={() => {
                    storeActions.installSource({ id: ext.id, name: ext.name, lang: ext.lang, isNsfw: ext.isNsfw, iconUrl: ext.iconUrl, isPinned: false });
                    toast({ title: `Added ${ext.name}`, description: "Open the Sources tab to browse it." });
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {visible.length < filtered.length && (
        <div className="flex justify-center py-4">
          <Button variant="outline" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
            <ChevronDown className="h-4 w-4 mr-1" /> Load more
          </Button>
        </div>
      )}
    </div>
  );
}
