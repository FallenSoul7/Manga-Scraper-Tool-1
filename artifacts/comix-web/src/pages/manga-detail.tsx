import { useRoute, Link, useLocation } from "wouter";
import {
  useGetMangaDetails,
  useGetChapters,
  getGetMangaDetailsQueryKey,
  getGetChaptersQueryKey,
} from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { proxyImage } from "@/lib/utils";
import { Loader2, ArrowLeft, Star, ChevronDown, ChevronUp, BookmarkPlus, BookOpen, Check, MoreVertical, ArrowDown, ArrowUp, Filter, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { useStore, storeActions } from "@/lib/storage";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const ALT_TITLES_COLLAPSED_LIMIT = 6;

// Server-style dedupe done client-side: prefer official → group 10702 → most votes → most recent.
// Used when no specific scanlator is selected so the chapter list still looks "clean" by default.
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
    if (!existing) {
      map.set(ch.number, ch);
      continue;
    }
    const s1 = score(ch);
    const s2 = score(existing);
    if (s1 > s2) map.set(ch.number, ch);
    else if (s1 === s2 && (ch.date || 0) > (existing.date || 0)) map.set(ch.number, ch);
  }
  return Array.from(map.values());
}

export default function MangaDetail() {
  const [, params] = useRoute("/manga/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const [showFullSynopsis, setShowFullSynopsis] = useState(false);
  const [showAllAltTitles, setShowAllAltTitles] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const progressMap = useStore(s => s.progress);
  const scanlatorPrefs = useStore(s => s.scanlatorPrefs);
  const chapterSortAsc = useStore(s => s.chapterSortAsc);
  
  const inLibrary = id ? !!library[id] : false;
  const savedManga = id ? library[id] : null;
  const selectedScanlator = id ? (scanlatorPrefs[id] ?? null) : null; // null = "All sources"
  const sortAsc = id ? !!chapterSortAsc[id] : false;

  const mangaParams = {
    poster: settings.posterQuality,
    alt: settings.showAltNames,
    score: settings.scorePosition,
  };
  // Always fetch ALL chapters (dedupe=false) so the scanlator filter can show every available source.
  // We do the dedupe client-side when no specific scanlator is selected.
  const chaptersParams = { dedupe: false };
  const { data: manga, isLoading: mangaLoading } = useGetMangaDetails(id || "", mangaParams, {
    query: {
      enabled: !!id,
      queryKey: getGetMangaDetailsQueryKey(id || "", mangaParams),
    },
  });

  const { data: chaptersResponse, isLoading: chaptersLoading } = useGetChapters(id || "", chaptersParams, {
    query: {
      enabled: !!id,
      queryKey: getGetChaptersQueryKey(id || "", chaptersParams),
    },
  });

  // All chapters as fetched (no dedupe). Keyed in the order returned (typically newest first).
  const allChapters = chaptersResponse?.items || [];

  // Group by scanlator for the filter UI, with counts
  const scanlatorGroups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; hasOfficial: boolean }>();
    for (const ch of allChapters) {
      const name = (ch.scanlator || "Unknown").trim() || "Unknown";
      const existing = map.get(name);
      if (existing) {
        existing.count += 1;
        if (ch.isOfficial) existing.hasOfficial = true;
      } else {
        map.set(name, { name, count: 1, hasOfficial: !!ch.isOfficial });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.hasOfficial !== b.hasOfficial) return a.hasOfficial ? -1 : 1;
      return b.count - a.count;
    });
  }, [allChapters]);

  // Filtered (and possibly deduped) chapter list to show
  const visibleChapters = useMemo(() => {
    let list: any[];
    if (selectedScanlator) {
      list = allChapters.filter(ch => (ch.scanlator || "Unknown") === selectedScanlator);
    } else {
      list = dedupeChapters(allChapters);
    }
    list = [...list].sort((a, b) => sortAsc ? a.number - b.number : b.number - a.number);
    return list;
  }, [allChapters, selectedScanlator, sortAsc]);

  const firstChapter = useMemo(() => {
    if (visibleChapters.length === 0) return null;
    return [...visibleChapters].sort((a, b) => a.number - b.number)[0];
  }, [visibleChapters]);

  // Find continue reading chapter (most recent progress for this manga)
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
        id: manga.id,
        title: manga.title,
        thumbnail: manga.thumbnail,
        type: manga.type,
        isNsfw: manga.isNsfw,
        author: manga.author || manga.artist,
        status: manga.status,
        addedAt: Date.now(),
        categoryIds: ['default'],
        lastChapterCountSeen: visibleChapters.length || 0,
      });
    }
  };

  const handleToggleCategory = (catId: string) => {
    if (!savedManga) return;
    const current = new Set(savedManga.categoryIds);
    if (current.has(catId)) current.delete(catId);
    else current.add(catId);
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

  return (
    <main className="container mx-auto px-4 py-6 sm:py-8 max-w-5xl animate-in fade-in duration-500">
      <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6 sm:mb-8 transition-colors text-sm sm:text-base">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Link>

      <div className="flex flex-col md:flex-row gap-6 md:gap-12">
        {/* Cover + actions block. On mobile the cover is wider and the action buttons sit
            in a compact 2-column grid directly underneath, exactly as requested:
              row 1 = [Library] [Continue]
              row 2 = [Read Ch. N] [status badges + stars] */}
        <div className="shrink-0 mx-auto md:mx-0 w-full max-w-[20rem] sm:max-w-[22rem] md:w-72 md:max-w-none">
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-lg mb-3 sm:mb-4">
            <img
              src={proxyImage(manga.thumbnail)}
              alt={manga.title}
              className="h-full w-full object-cover"
            />
            {manga.isNsfw && (
              <div className="absolute top-3 right-3 rounded-md bg-destructive px-2 py-1 text-xs font-bold text-destructive-foreground">
                18+
              </div>
            )}
          </div>

          {/* 2-column action grid */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {/* Library button: doubles as the category picker.
                - Not in library → tapping adds it to "Default" and immediately opens the
                  picker so the user can switch to another category.
                - Already in library → tapping removes it. */}
            <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
              <Button
                variant={inLibrary ? "secondary" : "default"}
                className="w-full font-semibold"
                onClick={() => {
                  if (inLibrary) {
                    storeActions.removeFromLibrary(manga.id);
                  } else {
                    handleToggleLibrary();
                    setIsCategoryDialogOpen(true);
                  }
                }}
              >
                {inLibrary ? (
                  <><Check className="mr-1.5 h-4 w-4" /> In Library</>
                ) : (
                  <><BookmarkPlus className="mr-1.5 h-4 w-4" /> Library</>
                )}
              </Button>

              {/* Continue button — column 2 */}
              {latestProgress ? (
                <Button
                  variant="outline"
                  className="w-full bg-primary/5 border-primary/20 hover:bg-primary/10 text-primary"
                  onClick={() => setLocation(`/reader/${latestProgress.chapterId}?mangaId=${manga.id}`)}
                >
                  <BookOpen className="mr-1.5 h-4 w-4" /> <span className="truncate">Continue Ch. {latestProgress.chapterNumber}</span>
                </Button>
              ) : (
                <div /> /* keep grid alignment when no progress yet */
              )}

              {/* Read first chapter — column 1.
                  Always render the slot so the action grid doesn't reflow when
                  the chapter list eventually arrives. While chapters are loading
                  we show a disabled skeleton so the user sees there is a button
                  coming, instead of an empty cell. */}
              {chaptersLoading ? (
                <Button variant="outline" className="w-full" disabled>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  <span className="truncate">Read first</span>
                </Button>
              ) : firstChapter ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setLocation(`/reader/${firstChapter.id}?mangaId=${manga.id}`)}
                >
                  <Play className="mr-1.5 h-4 w-4" /> <span className="truncate">Read Ch. {firstChapter.number}</span>
                </Button>
              ) : (
                <Button variant="outline" className="w-full" disabled>
                  <span className="truncate text-xs">No chapters</span>
                </Button>
              )}

              {/* Status / type / rating block — column 2.
                  Lives next to "Read Ch. N" so the metadata stays close to the actions
                  without taking another full row of vertical space. */}
              <div className="flex items-center justify-center gap-2 px-2 py-2 rounded-md border bg-muted/40 text-sm flex-wrap">
                <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 text-[11px] px-2 py-0">
                  {manga.status}
                </Badge>
                {manga.type && (
                  <Badge variant="outline" className="text-[11px] px-2 py-0">{manga.type}</Badge>
                )}
                {manga.rating && (
                  <div className="flex items-center gap-1 font-medium text-amber-500">
                    <Star className="h-3.5 w-3.5 fill-current" />
                    {manga.rating}
                  </div>
                )}
              </div>

              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Edit Categories</DialogTitle>
                </DialogHeader>
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
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                            isChecked
                              ? "bg-primary/10 border-primary/30 text-foreground"
                              : "bg-card border-border hover:bg-muted"
                          } ${isOnlyDefault ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
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
                    <Button variant="secondary" onClick={handleAddCategory} disabled={!newCatName.trim()}>
                      Add
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => setIsCategoryDialogOpen(false)} className="w-full sm:w-auto">Done</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex-1 space-y-5 sm:space-y-6 min-w-0">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-serif font-bold text-foreground mb-1.5 sm:mb-2 leading-tight break-words">
              {manga.title}
            </h1>
            <div className="text-sm sm:text-lg text-muted-foreground font-medium">
              {[manga.author, manga.artist].filter(Boolean).join(" • ")}
            </div>
          </div>

          {manga.genres && manga.genres.length > 0 && (
            <div className="-mx-4 sm:mx-0">
              <div className="flex gap-2 overflow-x-auto hide-scrollbar px-4 sm:px-0 pb-1 snap-x">
                {manga.genres.map(genre => (
                  <Badge key={genre} variant="secondary" className="font-normal whitespace-nowrap shrink-0 snap-start">{genre}</Badge>
                ))}
              </div>
            </div>
          )}

          {manga.synopsis && (
            <div className="prose prose-stone dark:prose-invert max-w-none">
              <div className={showFullSynopsis ? "" : "line-clamp-4 relative"}>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{manga.synopsis}</p>
                {!showFullSynopsis && (
                  <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-background to-transparent pointer-events-none" />
                )}
              </div>
              <button 
                onClick={() => setShowFullSynopsis(!showFullSynopsis)}
                className="mt-2 text-sm font-medium text-primary hover:underline flex items-center gap-1"
              >
                {showFullSynopsis ? (
                  <>Show Less <ChevronUp className="h-4 w-4" /></>
                ) : (
                  <>Read More <ChevronDown className="h-4 w-4" /></>
                )}
              </button>
            </div>
          )}

          {settings.showAltNames && altTitles.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">Alternative Titles</h3>
              <p className="text-sm text-muted-foreground leading-relaxed break-words">
                {altTitlesToShow.join(", ")}
                {!showAllAltTitles && altTitles.length > ALT_TITLES_COLLAPSED_LIMIT && "…"}
              </p>
              {altTitles.length > ALT_TITLES_COLLAPSED_LIMIT && (
                <button
                  onClick={() => setShowAllAltTitles(!showAllAltTitles)}
                  className="mt-1.5 text-sm font-medium text-primary hover:underline flex items-center gap-1"
                >
                  {showAllAltTitles ? (
                    <>Show Less <ChevronUp className="h-4 w-4" /></>
                  ) : (
                    <>Show All ({altTitles.length}) <ChevronDown className="h-4 w-4" /></>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-12 sm:mt-16">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-foreground flex items-center gap-3">
            Chapters 
            <span className="text-sm sm:text-base font-normal text-muted-foreground bg-muted px-3 py-0.5 sm:py-1 rounded-full">
              {visibleChapters.length}
            </span>
          </h2>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => id && storeActions.setChapterSortAsc(id, !sortAsc)}
              title={sortAsc ? "Showing oldest first" : "Showing newest first"}
              className="gap-1.5"
            >
              {sortAsc ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
              <span className="hidden sm:inline">{sortAsc ? "Oldest first" : "Newest first"}</span>
              <span className="sm:hidden">{sortAsc ? "Asc" : "Desc"}</span>
            </Button>

            {scanlatorGroups.length > 0 && (
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Filter className="h-4 w-4" />
                    <span className="hidden sm:inline">Source</span>
                    <span className="max-w-[120px] truncate text-primary">
                      {selectedScanlator || "All"}
                    </span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[320px] sm:w-[380px]">
                  <SheetHeader>
                    <SheetTitle>Translation Source</SheetTitle>
                  </SheetHeader>
                  <p className="text-xs text-muted-foreground mt-2 mb-4">
                    Choose which group's chapters to show. Selecting a single source mirrors how you'd
                    pick a translation team in Tachiyomi.
                  </p>
                  <div className="space-y-1.5 overflow-y-auto max-h-[calc(100dvh-180px)] pr-1">
                    <button
                      type="button"
                      onClick={() => id && storeActions.setScanlatorPref(id, null)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                        selectedScanlator === null
                          ? "bg-primary/10 border-primary/30 text-foreground"
                          : "bg-card border-border hover:bg-muted"
                      }`}
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
                        <button
                          key={g.name}
                          type="button"
                          onClick={() => id && storeActions.setScanlatorPref(id, g.name)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                            isActive
                              ? "bg-primary/10 border-primary/30 text-foreground"
                              : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate flex items-center gap-2">
                              {g.name}
                              {g.hasOfficial && (
                                <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-500/15 px-1.5 py-0.5 rounded">Official</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                              {g.count}
                            </span>
                            {isActive && <Check className="h-4 w-4 text-primary" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </SheetContent>
              </Sheet>
            )}

            {visibleChapters.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="px-2">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Mark all read</DropdownMenuItem>
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
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Mark all unread</DropdownMenuItem>
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
        
        {chaptersLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : visibleChapters.length === 0 ? (
          <div className="text-center text-muted-foreground py-16 border rounded-2xl bg-card/40">
            No chapters available{selectedScanlator ? ` from ${selectedScanlator}` : ""}.
          </div>
        ) : (
          <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleChapters.map((chapter) => {
              const pKey = `${manga.id}:${chapter.id}`;
              const p = progressMap[pKey];
              const isRead = p?.isRead;
              const inProgress = p && !isRead && p.totalPages > 0;

              return (
                <div 
                  key={chapter.id} 
                  className={`group p-3 sm:p-4 rounded-xl border border-border transition-all cursor-pointer flex flex-col gap-1 ${
                    isRead ? "bg-muted/30 opacity-70 hover:opacity-100" : "bg-card hover:border-primary/30 hover:bg-primary/5"
                  }`}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('.kebab-menu')) {
                      if (!p) {
                        storeActions.recordProgress({
                          mangaId: manga.id,
                          chapterId: chapter.id,
                          chapterNumber: chapter.number,
                          chapterTitle: chapter.title,
                          mangaTitle: manga.title,
                          mangaThumbnail: manga.thumbnail,
                          totalPages: 0,
                          lastPageRead: 0,
                          isRead: false
                        });
                      }
                      setLocation(`/reader/${chapter.id}?mangaId=${manga.id}`);
                    }
                  }}
                >
                  {/* Title + kebab. Use a tight gap so the 3-dots stays close to the
                      chapter info on mobile — no more huge empty middle stretch that
                      forced you to reach across the screen. */}
                  <div className="font-semibold text-sm sm:text-base text-foreground group-hover:text-primary transition-colors flex items-center gap-2 min-w-0">
                    {isRead && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">Read</Badge>}
                    {inProgress && <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 shrink-0">Pg {p.lastPageRead + 1}</Badge>}
                    <span className="truncate flex-1 min-w-0">Ch. {chapter.number}{chapter.title ? `: ${chapter.title}` : ""}</span>
                    {chapter.isOfficial && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-amber-500/20 text-amber-600 shrink-0">Official</Badge>}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 kebab-menu hover:bg-muted shrink-0 -mr-1" onClick={e => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="kebab-menu">
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          storeActions.markChapterRead(manga.id, chapter, manga);
                        }}>
                          Mark as read
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          storeActions.markChapterUnread(manga.id, chapter.id);
                        }}>
                          Mark as unread
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="text-xs text-muted-foreground flex justify-between gap-2">
                    <span className="truncate min-w-0">{chapter.scanlator || "Unknown"}</span>
                    <span className="shrink-0">{format(new Date(chapter.date * 1000), 'MMM d, yyyy')}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  );
}
