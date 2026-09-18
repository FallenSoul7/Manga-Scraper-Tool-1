import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useStore, storeActions, type Category } from "@/lib/storage";
import { proxyImage, readerUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, Clock, ChevronDown, ChevronUp, Sparkles, Plus, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useOnlineStatus } from "@/lib/offline-catalog";
import { useOfflineChapters } from "@/lib/offline-db";
import { checkMangaUpdates } from "@/lib/update-checker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const COLLAPSED_LIMIT = 6;

export default function UpdatesPage() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const online = useOnlineStatus();
  const offlineChapters = useOfflineChapters();
  const offlineChapterIds = new Set(offlineChapters.map(chapter => `${chapter.mangaId}:${chapter.chapterId}`));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedMangaIds, setSelectedMangaIds] = useState<Set<string>>(new Set());
  const didAutoCheck = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const libraryItems = useMemo(() => Object.values(library), [library]);
  const trackedItems = useMemo(() => libraryItems.filter(manga => manga.updatesEnabled), [libraryItems]);

  const updatesByManga = useMemo(() => trackedItems
    .filter(m => (m.pendingUpdates ?? []).length > 0)
    .map(m => {
      const chapters = [...(m.pendingUpdates ?? [])].sort((a, b) => b.number - a.number);
      return { manga: m, chapters, latestDate: chapters[0]?.date ?? 0 };
    })
    .sort((a, b) => b.latestDate - a.latestDate), [trackedItems]);

  const handleRefresh = useCallback(async () => {
    if (!online || trackedItems.length === 0) return;
    setIsRefreshing(true);
    try {
      await Promise.all(trackedItems.map(async (manga) => {
        try {
          const result = await checkMangaUpdates(manga);
          storeActions.recordDiscoveredUpdates(manga.id, result.newChapters, result.chapters.length, result.chapterIds);
        } catch (error) {
          console.warn(`Update check failed for ${manga.title}`, error);
        }
      }));
    } finally {
      setIsRefreshing(false);
    }
  }, [online, trackedItems]);

  refreshRef.current = handleRefresh;
  useEffect(() => {
    if (online && !didAutoCheck.current) {
      didAutoCheck.current = true;
      refreshRef.current();
    }
    if (!online) didAutoCheck.current = false;
  }, [online]);

  const openSelector = () => {
    setSelectedMangaIds(new Set(trackedItems.map(manga => manga.id)));
    setSelectorOpen(true);
  };

  const visibleSelectorItems = useMemo(() => libraryItems.filter(manga => selectedCategory === "all" || manga.categoryIds.includes(selectedCategory)), [libraryItems, selectedCategory]);
  const allVisibleSelected = visibleSelectorItems.length > 0 && visibleSelectorItems.every(manga => selectedMangaIds.has(manga.id));
  const toggleVisible = () => {
    setSelectedMangaIds(previous => {
      const next = new Set(previous);
      if (allVisibleSelected) visibleSelectorItems.forEach(manga => next.delete(manga.id));
      else visibleSelectorItems.forEach(manga => next.add(manga.id));
      return next;
    });
  };
  const saveSelection = () => {
    storeActions.setUpdatesForMany([...selectedMangaIds], true);
    storeActions.setUpdatesForMany(libraryItems.filter(manga => !selectedMangaIds.has(manga.id)).map(manga => manga.id), false);
    setSelectorOpen(false);
  };

  return (
    <main className="container mx-auto px-4 pt-3 pb-8 max-w-4xl animate-in fade-in duration-500">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div><h1 className="text-2xl font-serif font-bold">Updates</h1><p className="text-xs text-muted-foreground mt-1">{trackedItems.length} manga subscribed</p></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={openSelector} title="Choose manga to track"><Plus className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => refreshRef.current()} disabled={isRefreshing || !online || trackedItems.length === 0}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />{isRefreshing ? "Checking…" : online ? "Check now" : "Offline"}
          </Button>
          <Button variant="default" size="sm" onClick={storeActions.clearAllPendingUpdates} disabled={updatesByManga.length === 0}><CheckCircle2 className="h-4 w-4 mr-2" />Mark all seen</Button>
        </div>
      </div>

      {!online && <div className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">Showing saved pending updates. Checking for new chapters is disabled until you reconnect.</div>}
      {online && trackedItems.length === 0 && <div className="mb-5 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">Click the <strong>+</strong> button to choose which manga should be checked for new chapters.</div>}

      {isRefreshing && updatesByManga.length === 0 ? <div className="space-y-6">{[1, 2, 3].map(i => <div key={i} className="flex gap-4 p-4 border rounded-xl bg-card animate-pulse"><div className="w-16 h-24 bg-muted rounded-md" /><div className="flex-1 space-y-4 py-1"><div className="h-4 bg-muted rounded w-1/3" /><div className="h-8 bg-muted rounded w-1/4" /></div></div>)}</div>
        : updatesByManga.length === 0 ? <div className="py-24 flex flex-col items-center justify-center text-center px-4 border rounded-2xl bg-card/50"><Clock className="h-16 w-16 text-muted mb-6" /><h3 className="text-xl font-serif font-bold mb-2">All caught up</h3><p className="text-muted-foreground max-w-md mx-auto">{trackedItems.length ? "No new chapters were found for your subscribed manga." : "Choose manga with the + button to start automatic chapter updates."}</p></div>
        : <div className="space-y-4 sm:space-y-6">{updatesByManga.map(({ manga, chapters, latestDate }) => {
          const isExpanded = expanded[manga.id]; const hidden = Math.max(0, chapters.length - COLLAPSED_LIMIT); const visibleChapters = isExpanded ? chapters : chapters.slice(0, COLLAPSED_LIMIT);
          return <div key={manga.id} className="flex gap-3 sm:gap-4 p-3 sm:p-4 border rounded-xl bg-card hover:shadow-md transition-shadow">
            <Link href={`/manga/${encodeURIComponent(manga.id)}?sourceId=${encodeURIComponent(manga.sourceId ?? "")}`} className="shrink-0 cursor-pointer"><div className="w-14 sm:w-20 aspect-[2/3] rounded-md overflow-hidden bg-muted shadow-sm hover:opacity-80 transition-opacity"><img src={proxyImage(manga.thumbnail, manga.sourceId)} alt={manga.title} className="w-full h-full object-cover" /></div></Link>
            <div className="flex-1 min-w-0"><div className="flex items-start justify-between gap-2 mb-1"><Link href={`/manga/${encodeURIComponent(manga.id)}?sourceId=${encodeURIComponent(manga.sourceId ?? "")}`}><h3 className="font-serif font-semibold text-base sm:text-lg line-clamp-2 sm:truncate hover:text-primary transition-colors cursor-pointer">{manga.title}</h3></Link><button title="Mark as seen" onClick={() => storeActions.clearPendingUpdates(manga.id)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"><CheckCircle2 className="h-4 w-4" /></button></div><div className="text-xs text-muted-foreground mb-2 sm:mb-3">{chapters.length} new {chapters.length === 1 ? "chapter" : "chapters"}{latestDate > 0 && <> · Updated {formatDistanceToNow(latestDate * 1000, { addSuffix: true })}</>}</div><div className="flex flex-wrap gap-1.5 sm:gap-2">{visibleChapters.map(ch => { const canRead = online || offlineChapterIds.has(`${manga.id}:${ch.id}`); return canRead ? <Link key={String(ch.id)} href={readerUrl(ch.id, manga.id, manga.sourceId, !online)}><span className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md bg-primary/10 text-primary text-xs sm:text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"><Sparkles className="h-2.5 w-2.5" />Ch. {ch.number}</span></Link> : <span key={String(ch.id)} title="Download this chapter before going offline" className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md bg-muted text-muted-foreground text-xs sm:text-sm font-medium cursor-not-allowed">Ch. {ch.number}</span>; })}{hidden > 0 && <Button variant="ghost" size="sm" className="h-7 sm:h-8 px-2 text-xs sm:text-sm text-muted-foreground" onClick={() => setExpanded(s => ({ ...s, [manga.id]: !isExpanded }))}>{isExpanded ? <><ChevronUp className="h-3 w-3 mr-1" />Show less</> : <>+{hidden} more<ChevronDown className="h-3 w-3 ml-1" /></>}</Button>}</div></div>
          </div>;
        })}</div>}

      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Choose manga for automatic updates</DialogTitle><DialogDescription>Select the manga you want ComiHub to check for new chapters. Automatic means all new chapters for the selected titles.</DialogDescription></DialogHeader><div className="flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" /><select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"><option value="all">All categories</option>{categories.map((category: Category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><Button variant="outline" size="sm" onClick={toggleVisible}>{allVisibleSelected ? "Unselect visible" : "Select visible"}</Button></div><div className="max-h-[50vh] overflow-y-auto rounded-lg border">{visibleSelectorItems.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No manga in this category.</p> : visibleSelectorItems.map(manga => <label key={manga.id} className="flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer"><input type="checkbox" checked={selectedMangaIds.has(manga.id)} onChange={() => setSelectedMangaIds(previous => { const next = new Set(previous); if (next.has(manga.id)) next.delete(manga.id); else next.add(manga.id); return next; })} /><img src={proxyImage(manga.thumbnail, manga.sourceId)} alt="" className="h-10 w-7 rounded object-cover bg-muted" /><span className="flex-1 truncate text-sm">{manga.title}</span><span className="text-xs text-muted-foreground">{manga.sourceId ?? "source"}</span></label>)}</div><div className="flex justify-between items-center"><span className="text-xs text-muted-foreground">{selectedMangaIds.size} selected</span><Button onClick={saveSelection}>Save update selection</Button></div></DialogContent></Dialog>
    </main>
  );
}
