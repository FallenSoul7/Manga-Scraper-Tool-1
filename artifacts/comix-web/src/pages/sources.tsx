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
  Globe,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  X,
  SearchX,
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

const LANG_LABELS: Record<string, string> = {
  all: "Multi", en: "English", ar: "العربية", bg: "Български", ca: "Català",
  cs: "Čeština", de: "Deutsch", es: "Español", fr: "Français",
  id: "Bahasa Indonesia", it: "Italiano", ja: "日本語", ko: "한국어",
  pl: "Polski", pt: "Português", ru: "Русский", th: "ไทย",
  tr: "Türkçe", uk: "Українська", vi: "Tiếng Việt", zh: "中文",
};
const langLabel = (code: string) => LANG_LABELS[code] ?? code.toUpperCase();

function ExtensionAvatar({ ext, size = 48 }: { ext: { name: string; iconUrl: string | null }; size?: number }) {
  const [errored, setErrored] = useState(false);
  if (ext.iconUrl && !errored) {
    return (
      <img src={ext.iconUrl} alt="" width={size} height={size} loading="lazy"
        onError={() => setErrored(true)}
        className="rounded-md bg-muted shrink-0 object-cover" style={{ width: size, height: size }} />
    );
  }
  const initials = ext.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0 font-semibold"
      style={{ width: size, height: size, fontSize: size / 3 }}>
      {initials}
    </div>
  );
}

// ─── Global search results (Mihon-style) ────────────────────────────────────
interface GlobalResult { id: string; title: string; thumbnail: string; isNsfw?: boolean }
interface SourceResults { source: InstalledSource; items: GlobalResult[] }

function GlobalSearchResults({
  query, results, isSearching, onClear,
}: {
  query: string;
  results: SourceResults[];
  isSearching: boolean;
  onClear: () => void;
}) {
  if (isSearching) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Searching all sources for "{query}"…</p>
      </div>
    );
  }

  const withResults = results.filter(r => r.items.length > 0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between pb-3">
        <p className="text-sm text-muted-foreground">
          {withResults.length > 0
            ? <>{withResults.length} source{withResults.length !== 1 ? "s" : ""} returned results for <strong>"{query}"</strong></>
            : <>No results across all sources for <strong>"{query}"</strong></>}
        </p>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onClear}>
          <X className="h-3.5 w-3.5" /> Clear search
        </Button>
      </div>

      {withResults.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-4 text-center border rounded-2xl bg-card/50">
          <SearchX className="h-12 w-12 text-muted" />
          <p className="text-muted-foreground max-w-xs">
            None of your installed sources returned anything for this query. Try a different term.
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {withResults.map(({ source, items }) => (
            <div key={source.id}>
              {/* Source header */}
              <div className="flex items-center gap-2 mb-3">
                {source.iconUrl ? (
                  <img src={source.iconUrl} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-5 h-5 rounded bg-muted shrink-0" />
                )}
                <span className="font-semibold text-sm">{source.name}</span>
                {source.isNsfw && (
                  <span className="text-[10px] px-1.5 py-0 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold">18+</span>
                )}
                <span className="text-xs text-muted-foreground">{langLabel(source.lang)}</span>
                <div className="flex-1" />
                <Link href={`/sources/${source.id}`}>
                  <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                    More <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              </div>

              {/* Horizontal manga row */}
              <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar">
                {items.map((manga) => (
                  <Link key={manga.id} href={`/sources/${source.id}/manga/${manga.id}`}>
                    <div className="shrink-0 w-24 sm:w-28 cursor-pointer group">
                      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-muted mb-1.5 shadow-sm">
                        <img
                          src={proxyImage(manga.thumbnail, source.id)}
                          alt={manga.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                        {manga.isNsfw && (
                          <div className="absolute top-1 right-1 rounded px-1 py-0 text-[9px] font-bold bg-destructive/90 text-destructive-foreground">
                            18+
                          </div>
                        )}
                      </div>
                      <p className="text-xs font-medium line-clamp-2 leading-snug group-hover:text-primary transition-colors px-0.5">
                        {manga.title}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function SourcesPage() {
  const installedMap = useStore(s => s.installedSources);
  const activeId     = useStore(s => s.activeSourceId);
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const installed = useMemo(
    () => Object.values(installedMap).sort((a, b) => a.name.localeCompare(b.name)),
    [installedMap],
  );

  // Global search — driven by ?q= in the URL (set by header form)
  const urlQ = new URLSearchParams(searchString).get("q") ?? "";
  const [globalResults, setGlobalResults]   = useState<SourceResults[]>([]);
  const [isSearching, setIsSearching]       = useState(false);
  const [searchedQuery, setSearchedQuery]   = useState("");

  useEffect(() => {
    if (!urlQ) {
      setGlobalResults([]);
      setSearchedQuery("");
      return;
    }
    if (urlQ === searchedQuery && globalResults.length > 0) return; // already fetched

    setIsSearching(true);
    setSearchedQuery(urlQ);

    const run = async () => {
      const all = await Promise.allSettled(
        installed.map(async (src): Promise<SourceResults> => {
          try {
            const res = await fetch(
              `/api/search?query=${encodeURIComponent(urlQ)}&page=1`,
              { headers: { "X-Source": src.id } },
            );
            const data = await res.json();
            return { source: src, items: (data.items ?? []).slice(0, 12) };
          } catch {
            return { source: src, items: [] };
          }
        }),
      );
      const results = all
        .map(r => (r.status === "fulfilled" ? r.value : null))
        .filter((r): r is SourceResults => r !== null);
      setGlobalResults(results);
      setIsSearching(false);
    };

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  const clearSearch = () => {
    setLocation("/sources");
    setGlobalResults([]);
    setSearchedQuery("");
  };

  const showGlobalSearch = !!(urlQ || isSearching);

  return (
    <main className="container mx-auto px-4 pt-3 pb-8 max-w-5xl">
      {showGlobalSearch ? (
        <GlobalSearchResults
          query={urlQ || searchedQuery}
          results={globalResults}
          isSearching={isSearching}
          onClear={clearSearch}
        />
      ) : (
        <Tabs defaultValue="installed" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="installed" className="text-sm sm:text-base px-4 sm:px-6">
              Added
              <span className="ml-2 text-xs text-muted-foreground">{installed.length}</span>
            </TabsTrigger>
            <TabsTrigger value="browse" className="text-sm sm:text-base px-4 sm:px-6">
              Browse
            </TabsTrigger>
          </TabsList>

          <TabsContent value="installed" className="animate-in fade-in duration-300">
            <InstalledTab installed={installed} activeId={activeId} />
          </TabsContent>

          <TabsContent value="browse" className="animate-in fade-in duration-300">
            <BrowseTab installedMap={installedMap} />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

// ─── Installed tab ───────────────────────────────────────────────────────────
function InstalledTab({ installed, activeId }: { installed: InstalledSource[]; activeId: string }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  return (
    <div className="space-y-3">
      {installed.map((src) => {
        const isActive = src.id === activeId;
        return (
          <div
            key={src.id}
            role="button"
            tabIndex={0}
            onClick={() => { storeActions.setActiveSource(src.id); setLocation(`/sources/${src.id}`); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                storeActions.setActiveSource(src.id);
                setLocation(`/sources/${src.id}`);
              }
            }}
            className={`group flex items-center gap-4 p-3 sm:p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md hover:border-primary/40 ${
              isActive ? "border-primary bg-primary/5" : "bg-card"
            }`}
          >
            <ExtensionAvatar ext={src} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold truncate">{src.name}</h3>
                {isActive && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </span>
                )}
                {src.isNsfw && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
                    <ShieldAlert className="h-3 w-3" /> 18+
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <Globe className="h-3 w-3 inline mr-1" />
                {langLabel(src.lang)} · {src.id}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
              {src.id !== "en.comix" && (
                <Button size="icon" variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                  onClick={() => { storeActions.uninstallSource(src.id); toast({ title: `Removed ${src.name}` }); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <ChevronRight className="h-5 w-5 text-muted-foreground opacity-60 group-hover:opacity-100 group-hover:text-primary transition-colors" />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground pt-2">
        Tap any source to browse its popular &amp; latest titles. The default{" "}
        <strong>Comix</strong> source can't be removed. Visit the{" "}
        <strong>Browse</strong> tab to add more.
      </p>
    </div>
  );
}

// ─── Browse tab ──────────────────────────────────────────────────────────────
const SUPPORTED_FIRST = (a: CatalogExtension, b: CatalogExtension) =>
  Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name);
const PAGE_SIZE = 60;

function BrowseTab({ installedMap }: { installedMap: Record<string, InstalledSource> }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<CatalogResponse>({
    queryKey: ["sources-catalog"],
    queryFn: () => customFetch<CatalogResponse>("/api/sources/catalog"),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const [search, setSearch]             = useState("");
  const [lang, setLang]                 = useState<string>("all-langs");
  const [showNsfw, setShowNsfw]         = useState(false);
  const [supportedOnly, setSupportedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, lang, showNsfw, supportedOnly]);

  const allLangs = useMemo(() => {
    if (!data) return [] as string[];
    const set = new Set<string>();
    for (const e of data.extensions) set.add(e.lang);
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.extensions
      .filter(e => lang === "all-langs" ? true : e.lang === lang)
      .filter(e => showNsfw ? true : !e.isNsfw)
      .filter(e => supportedOnly ? e.supported : true)
      .filter(e => q ? e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q) : true)
      .sort(SUPPORTED_FIRST);
  }, [data, search, lang, showNsfw, supportedOnly]);

  const visible = filtered.slice(0, visibleCount);

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (error || !data) return <div className="text-center py-20 text-destructive">Failed to load extension catalog.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search extensions by name…" className="pl-9"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={lang} onChange={e => setLang(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm">
          <option value="all-langs">All languages ({data.count})</option>
          {allLangs.map(l => <option key={l} value={l}>{langLabel(l)}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-sm px-3 h-9 rounded-md border border-input bg-background cursor-pointer">
          <input type="checkbox" checked={supportedOnly} onChange={e => setSupportedOnly(e.target.checked)} />
          Available only
        </label>
        <label className="inline-flex items-center gap-2 text-sm px-3 h-9 rounded-md border border-input bg-background cursor-pointer">
          <input type="checkbox" checked={showNsfw} onChange={e => setShowNsfw(e.target.checked)} />
          18+
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()} extensions
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visible.map(ext => {
          const installed = !!installedMap[ext.id];
          return (
            <div key={ext.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <ExtensionAvatar ext={ext} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate text-sm">{ext.name}</h3>
                  {ext.isNsfw && (
                    <span className="text-[10px] px-1.5 py-0 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">18+</span>
                  )}
                  {!ext.supported && (
                    <span className="text-[10px] px-1.5 py-0 rounded bg-muted text-muted-foreground">Coming soon</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{langLabel(ext.lang)} · v{ext.versionCode}</p>
              </div>
              {installed ? (
                <span className="inline-flex items-center gap-1 text-xs text-primary px-2">
                  <CheckCircle2 className="h-4 w-4" /> Added
                </span>
              ) : (
                <Button size="sm" variant={ext.supported ? "default" : "outline"} disabled={!ext.supported}
                  onClick={() => {
                    storeActions.installSource({ id: ext.id, name: ext.name, lang: ext.lang, isNsfw: ext.isNsfw, iconUrl: ext.iconUrl });
                    toast({ title: `Added ${ext.name}`, description: "Open the Added tab and pick it to start browsing." });
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {visible.length < filtered.length && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
            <ChevronDown className="h-4 w-4 mr-1" /> Load more
          </Button>
        </div>
      )}
    </div>
  );
}
