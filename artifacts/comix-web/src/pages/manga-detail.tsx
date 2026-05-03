import { useLocation, useParams } from "wouter";
import {
  useGetMangaDetails,
  useGetChapters,
  getGetMangaDetailsQueryKey,
  getGetChaptersQueryKey,
} from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { proxyImage } from "@/lib/utils";
import { applyActiveSource } from "@/lib/source";
import {
  Loader2, ArrowLeft, Star, ChevronDown, ChevronUp,
  BookmarkPlus, BookOpen, Check, MoreVertical, ArrowDown,
  ArrowUp, Filter, Play, Sparkles, AlertCircle, X,
  Users, Globe, ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useMemo, useEffect, useRef } from "react";
import { format } from "date-fns";
import { useStore, storeActions, type PendingChapter } from "@/lib/storage";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const ALT_TITLES_COLLAPSED_LIMIT = 6;

function dedupeChapters(items: any[]): any[] {
  const map = new Map<number, any>();
  const score = (ch: any) => {
    let s = 0;
    if (ch.isOfficial) s += 100000;
    if (String(ch.scanlatorId || "") === "10702") s += 10000;
    s += (ch.votes || 0);
    return s;
  };
  for (const ch of items) {
    const existing = map.get(ch.number);
    if (!existing) { map.set(ch.number, ch); continue; }
    const s1 = score(ch), s2 = score(existing);
    if (s1 > s2) map.set(ch.number, ch);
    else if (s1 === s2 && (ch.date || 0) > (existing.date || 0)) map.set(ch.number, ch);
  }
  return Array.from(map.values());
}

function formatSourceId(sourceId: string) {
  const raw = sourceId.split(".").pop() || sourceId;
  return raw.replace(/\b\w/g, c => c.toUpperCase());
}

function StarRating({ value }: { value: string }) {
  const num = parseFloat(value);
  const out5 = num / 2;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => {
        const filled = out5 >= i;
        const half = !filled && out5 >= i - 0.5;
        return (
          <Star
            key={i}
            className={`h-3.5 w-3.5 ${filled ? "fill-amber-400 text-amber-400" : half ? "fill-amber-400/50 text-amber-400" : "text-muted-foreground/40"}`}
          />
        );
      })}
      <span className="text-sm font-semibold text-amber-500 ml-0.5">{num.toFixed(1)}</span>
    </div>
  );
}

export default function MangaDetail() {
  const params = useParams<{ id?: string; mangaId?: string; sourceId?: string }>();
  const id = params.id ?? params.mangaId ?? null;
  const sourceContext = params.sourceId ?? null;
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const [showFullSynopsis, setShowFullSynopsis] = useState(false);
  const [showAllAltTitles, setShowAllAltTitles] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [coverZoomOpen, setCoverZoomOpen] = useState(false);
  const [scanlatorSheetOpen, setScanlatorSheetOpen] = useState(false);

  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const progressMap = useStore(s => s.progress);
  const activeSourceId = useStore(s => s.activeSourceId);
  const scanlatorPrefs = useStore(s => s.scanlatorPrefs);
  const chapterSortAsc = useStore(s => s.chapterSortAsc);

  const inLibrary = id ? !!library[id] : false;
  const savedManga = id ? library[id] : null;
  const selectedScanlator = id ? (scanlatorPrefs[id] ?? null) : null;
  const sortAsc = id ? !!chapterSortAsc[id] : false;

  const librarySourceId = savedManga?.sourceId ?? null;
  const needsSourceInit = !!(sourceContext || librarySourceId);
  const [sourceReady, setSourceReady] = useState(!needsSourceInit);

  useEffect(() => {
    const effectiveSource = sourceContext ?? librarySourceId;
    if (effectiveSource) { applyActiveSource(effectiveSource); setSourceReady(true); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceContext, librarySourceId]);

  const mangaParams = { poster: settings.posterQuality, alt: settings.showAltNames, score: settings.scorePosition };
  const chaptersParams = { dedupe: false };

  const { data: manga, isLoading: mangaLoading } = useGetMangaDetails(id || "", mangaParams, {
    query: { enabled: !!id && sourceReady, queryKey: getGetMangaDetailsQueryKey(id || "", mangaParams) },
  });
  const { data: chaptersResponse, isLoading: chaptersLoading, isError: chaptersError } = useGetChapters(id || "", chaptersParams, {
    query: { enabled: !!id && sourceReady, queryKey: getGetChaptersQueryKey(id || "", chaptersParams) },
  });

  const allChapters = chaptersResponse?.items || [];

  const newChapterIds = useMemo(() => {
    if (!savedManga) return new Set<number>();
    return new Set((savedManga.pendingUpdates ?? []).map(c => c.id));
  }, [savedManga]);

  const didRecordRef = useRef(false);
  useEffect(() => {
    if (!id || !inLibrary || chaptersLoading || allChapters.length === 0) return;
    if (didRecordRef.current) return;
    didRecordRef.current = true;
    const seen = savedManga?.lastChapterCountSeen ?? 0;
    const total = allChapters.length;
    if (total > seen) {
      const fresh = allChapters.slice(0, total - seen);
      const stubs: PendingChapter[] = fresh.map((ch: any) => ({ id: ch.id as number, number: ch.number as number, title: (ch.title as string) ?? "", date: ch.date as number }));
      storeActions.recordDiscoveredUpdates(id, stubs, total);
    } else if (total > 0) {
      storeActions.markChaptersSeen(id, total);
    }
  }, [id, inLibrary, chaptersLoading, allChapters.length]);

  const scanlatorGroups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; hasOfficial: boolean }>();
    for (const ch of allChapters) {
      const name = (ch.scanlator || "Unknown").trim() || "Unknown";
      const existing = map.get(name);
      if (existing) { existing.count += 1; if (ch.isOfficial) existing.hasOfficial = true; }
      else map.set(name, { name, count: 1, hasOfficial: !!ch.isOfficial });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.hasOfficial !== b.hasOfficial) return a.hasOfficial ? -1 : 1;
      return b.count - a.count;
    });
  }, [allChapters]);

  const visibleChapters = useMemo(() => {
    let list: any[] = selectedScanlator
      ? allChapters.filter((ch: any) => (ch.scanlator || "Unknown") === selectedScanlator)
      : dedupeChapters(allChapters);
    return [...list].sort((a, b) => sortAsc ? a.number - b.number : b.number - a.number);
  }, [allChapters, selectedScanlator, sortAsc]);

  const firstChapter = useMemo(() => {
    if (visibleChapters.length === 0) return null;
    return [...visibleChapters].sort((a, b) => a.number - b.number)[0];
  }, [visibleChapters]);

  const latestProgress = useMemo(() => {
    if (!id) return null;
    const items = Object.values(progressMap).filter(p => p.mangaId === id);
    if (items.length === 0) return null;
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return items[0];
  }, [id, progressMap]);

  const handleToggleLibrary = () => {
    if (!manga) return;
    if (inLibrary) {
      storeActions.removeFromLibrary(manga.id);
    } else {
      storeActions.addToLibrary({
        id: manga.id, title: manga.title, thumbnail: manga.thumbnail,
        type: manga.type, isNsfw: manga.isNsfw, author: manga.author || manga.artist,
        status: manga.status, sourceId: sourceContext ?? activeSourceId,
        addedAt: Date.now(), categoryIds: ['default'],
        lastChapterCountSeen: visibleChapters.length || 0, pendingUpdates: [],
      });
    }
  };

  const handleToggleCategory = (catId: string) => {
    if (!savedManga) return;
    const current = new Set(savedManga.categoryIds);
    if (current.has(catId)) current.delete(catId); else current.add(catId);
    if (current.size === 0) current.add('default');
    storeActions.setMangaCategories(savedManga.id, Array.from(current));
  };

  const handleAddCategory = () => {
    if (newCatName.trim()) {
      const cat = storeActions.addCategory(newCatName.trim());
      handleToggleCategory(cat.id);
      setNewCatName("");
    }
  };

  if (mangaLoading) {
    return <div className="flex justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!manga) {
    return <div className="py-32 text-center text-muted-foreground">Manga not found.</div>;
  }

  const altTitles = manga.altTitles || [];
  const altTitlesToShow = showAllAltTitles ? altTitles : altTitles.slice(0, ALT_TITLES_COLLAPSED_LIMIT);
  const effectiveSource = sourceContext ?? activeSourceId;
  const sourceName = effectiveSource ? formatSourceId(effectiveSource) : null;

  return (
    <div style={{ maxWidth: '100vw', overflowX: 'hidden' }}>
      <div className="max-w-3xl mx-auto animate-in fade-in duration-500">

        {/* ── Hero banner — back/action buttons float over it ── */}
        <div className="relative overflow-hidden" style={{ minHeight: 200 }}>
          {/* Blurred background — extends behind the floating top buttons */}
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={proxyImage(manga.thumbnail, sourceContext ?? undefined)}
              alt=""
              style={{ filter: "blur(24px)", objectFit: "cover", width: "100%", height: "100%" }}
            />
            <div className="absolute inset-0 bg-background/80 dark:bg-background/88" />
          </div>

          {/* Floating back arrow — top-left, over the blurred hero */}
          <button
            type="button"
            onClick={() => window.history.back()}
            className="absolute top-3 left-3 z-20 flex items-center justify-center h-9 w-9 rounded-full bg-black/25 backdrop-blur-sm text-white hover:bg-black/40 active:scale-90 transition-all"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {/* Floating right actions — top-right */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1">
            {sourceContext && (
              <a
                href={`https://comix.to`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-9 w-9 rounded-full bg-black/25 backdrop-blur-sm text-white hover:bg-black/40 active:scale-90 transition-all"
              >
                <ExternalLink className="h-[18px] w-[18px]" />
              </a>
            )}
          </div>

          {/* Cover + info — top padding reserves space for floating buttons */}
          <div className="relative z-10 flex items-end gap-3 px-4 pb-4 pt-14">
            {/* Cover */}
            <button
              type="button"
              className="shrink-0 w-[108px] sm:w-[120px] aspect-[2/3] rounded-xl overflow-hidden shadow-2xl bg-muted active:scale-95 transition-transform"
              onClick={() => setCoverZoomOpen(true)}
              title="Tap to zoom"
            >
              <img
                src={proxyImage(manga.thumbnail, sourceContext ?? undefined)}
                alt={manga.title}
                className="w-full h-full object-cover"
              />
            </button>

            {/* Info column */}
            <div className="flex-1 min-w-0 overflow-hidden pb-1 space-y-1">
              <h1 className="font-bold text-lg sm:text-xl text-foreground leading-tight break-words line-clamp-3">
                {manga.title}
              </h1>

              {(manga.author || manga.artist) && (
                <p className="text-sm text-muted-foreground truncate">
                  {[manga.author, manga.artist].filter(Boolean).join(", ")}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {manga.status && (
                  <span className="flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full inline-block ${manga.status.toLowerCase().includes("ongoing") ? "bg-green-500" : "bg-muted-foreground"}`} />
                    {manga.status}
                  </span>
                )}
                {manga.type && <span>• {manga.type}</span>}
                {sourceName && (
                  <span className="flex items-center gap-1">
                    •
                    <Globe className="h-3 w-3" />
                    {sourceName}
                  </span>
                )}
              </div>

              {manga.rating && <StarRating value={manga.rating} />}

              {manga.isNsfw && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">18+</Badge>
              )}
            </div>
          </div>
        </div>

        {/* ── Action row (Tachiyomi-style columns) ── */}
        <div className="flex items-stretch border-b border-border/50">
          {/* Add to Library */}
          <button
            type="button"
            onClick={() => {
              if (inLibrary) {
                storeActions.removeFromLibrary(manga.id);
              } else {
                handleToggleLibrary();
                setIsCategoryDialogOpen(true);
              }
            }}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-3 text-muted-foreground hover:text-primary hover:bg-muted/30 transition-colors"
          >
            {inLibrary
              ? <Check className="h-5 w-5 text-primary" />
              : <BookmarkPlus className="h-5 w-5" />}
            <span className="text-[11px] font-medium leading-tight text-center">
              {inLibrary ? "In Library" : "Add to Library"}
            </span>
          </button>

          {/* Web view — shown when in source context */}
          {sourceContext && (
            <a
              href={`https://comix.to`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex flex-col items-center justify-center gap-1 py-3 text-muted-foreground hover:text-primary hover:bg-muted/30 transition-colors border-l border-border/50"
            >
              <Globe className="h-5 w-5" />
              <span className="text-[11px] font-medium">Web View</span>
            </a>
          )}
        </div>

        {/* ── Synopsis ── */}
        {manga.synopsis && (
          <div className="px-4 pt-4 pb-2">
            <div className={showFullSynopsis ? "" : "relative"}>
              <p className={`text-sm text-muted-foreground leading-relaxed ${showFullSynopsis ? "" : "line-clamp-3"}`}>
                {manga.synopsis}
              </p>
              {!showFullSynopsis && (
                <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
              )}
            </div>
            <button
              onClick={() => setShowFullSynopsis(!showFullSynopsis)}
              className="mt-1.5 text-xs font-medium text-primary hover:underline flex items-center gap-0.5"
            >
              {showFullSynopsis
                ? <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
                : <><ChevronDown className="h-3.5 w-3.5" /> Read more</>}
            </button>
          </div>
        )}

        {/* ── Genres ── */}
        {manga.genres && manga.genres.length > 0 && (
          <div className="px-4 pb-3">
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              {[...new Set(manga.genres as string[])].map((genre, i) => (
                <Badge key={`${genre}-${i}`} variant="secondary" className="whitespace-nowrap shrink-0 font-normal text-xs">
                  {genre}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Alt titles ── */}
        {settings.showAltNames && altTitles.length > 0 && (
          <div className="px-4 pb-4">
            <p className="text-xs text-muted-foreground leading-relaxed break-words">
              {altTitlesToShow.join(", ")}
              {!showAllAltTitles && altTitles.length > ALT_TITLES_COLLAPSED_LIMIT && "…"}
            </p>
            {altTitles.length > ALT_TITLES_COLLAPSED_LIMIT && (
              <button onClick={() => setShowAllAltTitles(!showAllAltTitles)} className="mt-1 text-xs font-medium text-primary hover:underline flex items-center gap-0.5">
                {showAllAltTitles
                  ? <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
                  : <><ChevronDown className="h-3.5 w-3.5" /> Show all ({altTitles.length})</>}
              </button>
            )}
          </div>
        )}

        {/* ── START / CONTINUE READING button ── */}
        <div className="px-4 pb-5">
          {chaptersLoading ? (
            <Button className="w-full h-12 text-base font-semibold rounded-xl" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </Button>
          ) : latestProgress ? (
            <Button
              className="w-full h-12 text-base font-semibold rounded-xl"
              onClick={() => setLocation(`/reader/${latestProgress.chapterId}?mangaId=${manga.id}`)}
            >
              <BookOpen className="mr-2 h-5 w-5" />
              Continue reading · Ch. {latestProgress.chapterNumber}
            </Button>
          ) : firstChapter ? (
            <Button
              className="w-full h-12 text-base font-semibold rounded-xl"
              onClick={() => setLocation(`/reader/${firstChapter.id}?mangaId=${manga.id}`)}
            >
              <Play className="mr-2 h-5 w-5" />
              Start reading
            </Button>
          ) : (
            <Button className="w-full h-12 text-base font-semibold rounded-xl" disabled>
              No chapters available
            </Button>
          )}
        </div>

        {/* ── Chapters section ── */}
        <div className="border-t border-border/50">

          {/* Chapter header — Tachiyomi style */}
          <div className="flex items-center gap-2 px-4 py-3">
            <div className="flex-1 min-w-0">
              <span className="font-bold text-sm">
                {chaptersLoading ? "…" : `${visibleChapters.length} Chapter${visibleChapters.length !== 1 ? "s" : ""}`}
              </span>
              {scanlatorGroups.length > 1 && (
                <button
                  type="button"
                  onClick={() => setScanlatorSheetOpen(true)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                >
                  <Users className="h-3 w-3" />
                  {scanlatorGroups.length} Scanlators
                </button>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => id && storeActions.setChapterSortAsc(id, !sortAsc)}>
                {sortAsc ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              </Button>

              {scanlatorGroups.length > 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setScanlatorSheetOpen(true)}>
                  <Filter className="h-4 w-4" />
                </Button>
              )}

              {visibleChapters.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem onSelect={e => e.preventDefault()}>Mark all read</DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Mark all read?</AlertDialogTitle>
                          <AlertDialogDescription>This will mark all {visibleChapters.length} visible chapters as read.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => storeActions.markAllChaptersRead(manga.id, visibleChapters, manga)}>Confirm</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem onSelect={e => e.preventDefault()}>Mark all unread</DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Mark all unread?</AlertDialogTitle>
                          <AlertDialogDescription>This will remove all reading progress for this series.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => storeActions.markAllChaptersUnread(manga.id)}>Confirm</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Scanlator picker sheet */}
          <Sheet open={scanlatorSheetOpen} onOpenChange={setScanlatorSheetOpen}>
            <SheetContent side="bottom" className="max-h-[70dvh]">
              <SheetHeader><SheetTitle>Translation Source</SheetTitle></SheetHeader>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Choose which group's chapters to show.</p>
              <div className="space-y-1.5 overflow-y-auto max-h-[calc(70dvh-120px)] pr-1">
                <button
                  type="button"
                  onClick={() => { id && storeActions.setScanlatorPref(id, null); setScanlatorSheetOpen(false); }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${selectedScanlator === null ? "bg-primary/10 border-primary/30" : "bg-card border-border hover:bg-muted"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">All sources (recommended)</div>
                    <div className="text-xs text-muted-foreground">One chapter per number, official preferred</div>
                  </div>
                  {selectedScanlator === null && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
                {scanlatorGroups.map(g => {
                  const isActive = selectedScanlator === g.name;
                  return (
                    <button key={g.name} type="button"
                      onClick={() => { id && storeActions.setScanlatorPref(id, g.name); setScanlatorSheetOpen(false); }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${isActive ? "bg-primary/10 border-primary/30" : "bg-card border-border hover:bg-muted"}`}
                    >
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {g.name}
                        {g.hasOfficial && <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-500/15 px-1.5 py-0.5 rounded">Official</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{g.count}</span>
                        {isActive && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>

          {/* Loading / error banners */}
          {chaptersLoading && inLibrary && (
            <div className="mx-4 mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5 text-sm text-primary animate-pulse">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Checking for new chapters…
            </div>
          )}
          {chaptersError && (
            <div className="mx-4 mb-3 flex items-center gap-2 px-4 py-3 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Chapters could not be loaded — the source may be temporarily unavailable.</span>
            </div>
          )}

          {/* Chapter rows */}
          {chaptersLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : chaptersError ? null : visibleChapters.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 px-4">
              No chapters available{selectedScanlator ? ` from ${selectedScanlator}` : ""}.
            </div>
          ) : (
            <div className="divide-y divide-border/40 pb-8">
              {visibleChapters.map((chapter) => {
                const pKey = `${manga.id}:${chapter.id}`;
                const p = progressMap[pKey];
                const isRead = p?.isRead;
                const inProgress = p && !isRead && p.totalPages > 0;
                const isNew = newChapterIds.has(chapter.id);

                return (
                  <div
                    key={chapter.id}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isRead ? "opacity-40 hover:opacity-70" : "hover:bg-muted/40"}`}
                    onClick={e => {
                      if ((e.target as HTMLElement).closest('.kebab-menu')) return;
                      if (!p) {
                        storeActions.recordProgress({
                          mangaId: manga.id, chapterId: chapter.id,
                          chapterNumber: chapter.number, chapterTitle: chapter.title,
                          mangaTitle: manga.title, mangaThumbnail: manga.thumbnail,
                          totalPages: 0, lastPageRead: 0, isRead: false,
                        });
                      }
                      setLocation(`/reader/${chapter.id}?mangaId=${manga.id}`);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {isNew && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1.5 py-0 h-4 rounded bg-primary text-primary-foreground shrink-0">
                            <Sparkles className="h-2.5 w-2.5" />NEW
                          </span>
                        )}
                        {inProgress && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 shrink-0">Pg {p.lastPageRead + 1}</Badge>
                        )}
                        <span className="font-medium text-sm text-foreground">
                          Chapter {chapter.number}{chapter.title ? `: ${chapter.title}` : ""}
                        </span>
                        {chapter.isOfficial && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-amber-500/20 text-amber-600 shrink-0">Official</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{format(new Date(chapter.date * 1000), 'MMM d, yyyy')}</span>
                        {chapter.scanlator && <><span>·</span><span className="truncate">{chapter.scanlator}</span></>}
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 kebab-menu shrink-0" onClick={e => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="kebab-menu">
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); storeActions.markChapterRead(manga.id, chapter, manga); }}>
                          Mark as read
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); storeActions.markChapterUnread(manga.id, chapter.id); }}>
                          Mark as unread
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cover zoom lightbox */}
      {coverZoomOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setCoverZoomOpen(false)}
        >
          <button
            className="absolute top-4 right-4 h-9 w-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setCoverZoomOpen(false)}
          >
            <X className="h-5 w-5 text-white" />
          </button>
          <img
            src={proxyImage(manga.thumbnail, sourceContext ?? undefined)}
            alt={manga.title}
            className="max-h-[85dvh] max-w-[85vw] rounded-xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Category dialog */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Categories</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <div className="space-y-1.5">
              {categories.map(cat => {
                const isChecked = !!savedManga?.categoryIds.includes(cat.id);
                const isOnlyDefault = cat.id === 'default' && savedManga?.categoryIds.length === 1 && savedManga?.categoryIds.includes('default');
                return (
                  <button
                    key={cat.id}
                    type="button"
                    disabled={isOnlyDefault}
                    onClick={() => handleToggleCategory(cat.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${isChecked ? "bg-primary/10 border-primary/30 text-foreground" : "bg-card border-border hover:bg-muted"} ${isOnlyDefault ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className="font-medium text-sm">{cat.name}</span>
                    {isChecked && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-3 border-t">
              <Input
                placeholder="New category name..."
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } }}
              />
              <Button variant="secondary" onClick={handleAddCategory} disabled={!newCatName.trim()}>Add</Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsCategoryDialogOpen(false)} className="w-full sm:w-auto">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
