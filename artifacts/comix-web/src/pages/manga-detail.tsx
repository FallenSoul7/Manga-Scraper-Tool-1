import { useRoute, Link, useLocation } from "wouter";
import {
  useGetMangaDetails,
  useGetChapters,
  getGetMangaDetailsQueryKey,
  getGetChaptersQueryKey,
} from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { proxyImage } from "@/lib/utils";
import { Loader2, ArrowLeft, Star, ChevronDown, ChevronUp, Heart, BookmarkPlus, BookOpen, Check, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { useStore, storeActions } from "@/lib/storage";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function MangaDetail() {
  const [, params] = useRoute("/manga/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const [showFullSynopsis, setShowFullSynopsis] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const progressMap = useStore(s => s.progress);
  
  const inLibrary = id ? !!library[id] : false;
  const savedManga = id ? library[id] : null;

  const mangaParams = {
    poster: settings.posterQuality,
    alt: settings.showAltNames,
    score: settings.scorePosition,
  };
  const chaptersParams = { dedupe: settings.dedupeChapters };
  const { data: manga, isLoading: mangaLoading } = useGetMangaDetails(id || "", mangaParams, {
    query: {
      enabled: !!id,
      queryKey: getGetMangaDetailsQueryKey(id || "", mangaParams),
    },
  });

  const { data: chapters, isLoading: chaptersLoading } = useGetChapters(id || "", chaptersParams, {
    query: {
      enabled: !!id,
      queryKey: getGetChaptersQueryKey(id || "", chaptersParams),
    },
  });

  // Find continue reading chapter
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
        lastChapterCountSeen: chapters?.items.length || 0,
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

  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl animate-in fade-in duration-500">
      <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-primary mb-8 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Library
      </Link>

      <div className="flex flex-col md:flex-row gap-8 md:gap-12">
        <div className="shrink-0 mx-auto md:mx-0 w-64 md:w-80">
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-lg mb-6">
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

          <div className="flex flex-col gap-3">
            <Button 
              variant={inLibrary ? "secondary" : "default"} 
              className="w-full font-semibold"
              onClick={handleToggleLibrary}
            >
              {inLibrary ? (
                <><Check className="mr-2 h-4 w-4" /> In Library</>
              ) : (
                <><BookmarkPlus className="mr-2 h-4 w-4" /> Add to Library</>
              )}
            </Button>
            
            {inLibrary && (
              <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full">Categories</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Categories</DialogTitle>
                  </DialogHeader>
                  <div className="py-4 space-y-4">
                    <div className="space-y-2">
                      {categories.map(cat => (
                        <div key={cat.id} className="flex items-center space-x-2">
                          <Checkbox 
                            id={`cat-${cat.id}`} 
                            checked={savedManga?.categoryIds.includes(cat.id)}
                            onCheckedChange={() => handleToggleCategory(cat.id)}
                            disabled={cat.id === 'default' && savedManga?.categoryIds.length === 1 && savedManga?.categoryIds.includes('default')}
                          />
                          <label htmlFor={`cat-${cat.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {cat.name}
                          </label>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-4 border-t">
                      <Input 
                        placeholder="New category..." 
                        value={newCatName}
                        onChange={e => setNewCatName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                      />
                      <Button variant="secondary" onClick={handleAddCategory}>Add</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            {latestProgress && (
              <Button 
                variant="outline" 
                className="w-full bg-primary/5 border-primary/20 hover:bg-primary/10 text-primary"
                onClick={() => setLocation(`/reader/${latestProgress.chapterId}?mangaId=${manga.id}`)}
              >
                <BookOpen className="mr-2 h-4 w-4" /> Continue Reading (Ch. {latestProgress.chapterNumber})
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-6">
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">{manga.status}</Badge>
              {manga.type && <Badge variant="outline">{manga.type}</Badge>}
              {manga.rating && (
                <div className="flex items-center gap-1 text-sm font-medium text-amber-500">
                  <Star className="h-4 w-4 fill-current" />
                  {manga.rating}
                </div>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif font-bold text-foreground mb-2 leading-tight">
              {manga.title}
            </h1>
            <div className="text-lg text-muted-foreground font-medium">
              {[manga.author, manga.artist].filter(Boolean).join(" • ")}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {manga.genres?.map(genre => (
              <Badge key={genre} variant="secondary" className="font-normal">{genre}</Badge>
            ))}
          </div>

          {manga.synopsis && (
            <div className="prose prose-stone dark:prose-invert max-w-none">
              <div className={showFullSynopsis ? "" : "line-clamp-4 relative"}>
                <p className="text-muted-foreground leading-relaxed">{manga.synopsis}</p>
                {!showFullSynopsis && (
                  <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-background to-transparent" />
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

          {settings.showAltNames && manga.altTitles && manga.altTitles.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Alternative Titles</h3>
              <p className="text-sm text-muted-foreground">{manga.altTitles.join(", ")}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-serif font-bold text-foreground flex items-center gap-3">
            Chapters 
            <span className="text-base font-normal text-muted-foreground bg-muted px-3 py-1 rounded-full">
              {chapters?.items.length || 0}
            </span>
          </h2>

          <div className="flex items-center gap-2">
            {chapters?.items.length ? (
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">Mark all read</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mark all read?</AlertDialogTitle>
                      <AlertDialogDescription>This will mark all {chapters.items.length} chapters as read.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => storeActions.markAllChaptersRead(manga.id, chapters.items, manga)}>Confirm</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">Mark all unread</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mark all unread?</AlertDialogTitle>
                      <AlertDialogDescription>This will remove all reading progress for this manga.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => storeActions.markAllChaptersUnread(manga.id)}>Confirm</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
          </div>
        </div>
        
        {chaptersLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {chapters?.items.map((chapter) => {
              const pKey = `${manga.id}:${chapter.id}`;
              const p = progressMap[pKey];
              const isRead = p?.isRead;
              const inProgress = p && !isRead && p.totalPages > 0;

              return (
                <div 
                  key={chapter.id} 
                  className={`group p-4 rounded-xl border border-border transition-all cursor-pointer flex flex-col gap-1 ${
                    isRead ? "bg-muted/30 opacity-70 hover:opacity-100" : "bg-card hover:border-primary/30 hover:bg-primary/5"
                  }`}
                  onClick={(e) => {
                    // Navigate to reader
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
                  <div className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-start justify-between gap-2">
                    <span className="line-clamp-1 flex items-center gap-2">
                      {isRead && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Read</Badge>}
                      {inProgress && <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">Pg {p.lastPageRead + 1}</Badge>}
                      Chapter {chapter.number}: {chapter.title}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {chapter.isOfficial && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-amber-500/20 text-amber-600">Official</Badge>}
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 kebab-menu hover:bg-muted" onClick={e => e.stopPropagation()}>
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
                  </div>
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span className="truncate max-w-[60%]">{chapter.scanlator || "Unknown"}</span>
                    <span>{format(new Date(chapter.date * 1000), 'MMM d, yyyy')}</span>
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
