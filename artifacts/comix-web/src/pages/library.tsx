import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useStore, storeActions } from "@/lib/storage";
import { MangaCard } from "@/components/manga-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, LibraryBig, MoreHorizontal } from "lucide-react";
import { useRegisterHeaderSearch } from "@/lib/header-search";

const FALLBACK_TAB = "default";

export default function LibraryPage() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories],
  );

  // Read category from URL ?cat= so that going back from manga detail restores the right tab.
  const catFromUrl = new URLSearchParams(searchString).get("cat");
  const [activeTab, setActiveTabState] = useState<string>(() => {
    const fromUrl = catFromUrl;
    if (fromUrl && (sortedCategories.find(c => c.id === fromUrl) || fromUrl === FALLBACK_TAB)) {
      return fromUrl;
    }
    return sortedCategories[0]?.id ?? FALLBACK_TAB;
  });

  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    setLocation(id === FALLBACK_TAB ? "/" : `/?cat=${id}`, { replace: true });
  };

  // Refs for auto-scroll behaviour on the category strip.
  const stripRef = useRef<HTMLDivElement>(null);
  const tabElsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // If the active category gets deleted out from under us, fall back to the
  // first available one so the grid never goes blank.
  useEffect(() => {
    if (!sortedCategories.find(c => c.id === activeTab)) {
      setActiveTab(sortedCategories[0]?.id ?? FALLBACK_TAB);
    }
  }, [sortedCategories, activeTab]);

  // Whenever the active tab changes, scroll the strip so the active tile is
  // fully visible — plus a ~56 px "peek" revealing the neighbouring tile so
  // the user knows more categories exist.
  useEffect(() => {
    const strip = stripRef.current;
    const el = tabElsRef.current.get(activeTab);
    if (!strip || !el) return;

    // Use getBoundingClientRect for pixel-perfect positioning regardless of
    // what the offsetParent happens to be.
    const PEEK = 56;
    const stripRect = strip.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    // Convert the element's viewport-relative position to a position relative
    // to the scroll container's content (accounting for current scroll offset).
    const elLeft  = elRect.left  - stripRect.left + strip.scrollLeft;
    const elRight = elRect.right - stripRect.left + strip.scrollLeft;

    let targetScroll: number | null = null;

    if (elRight + PEEK > strip.scrollLeft + strip.clientWidth) {
      // Active tile is near/past the right edge → scroll right to show peek.
      targetScroll = elRight + PEEK - strip.clientWidth;
    } else if (elLeft - PEEK < strip.scrollLeft) {
      // Active tile is near/past the left edge → scroll left to show peek.
      targetScroll = Math.max(0, elLeft - PEEK);
    }

    if (targetScroll !== null) {
      strip.scrollTo({ left: targetScroll, behavior: "smooth" });
    }
  }, [activeTab]);

  // Live in-grid filter driven by the global header search.
  const [filterText, setFilterText] = useState("");

  const activeCatName = sortedCategories.find(c => c.id === activeTab)?.name ?? "library";
  useRegisterHeaderSearch(
    {
      placeholder: `Filter ${activeCatName}…`,
      initialQuery: filterText,
      onChange: (q) => setFilterText(q),
    },
    [activeTab, activeCatName],
  );

  const [newCatName, setNewCatName] = useState("");
  const [isNewCatOpen, setIsNewCatOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const libraryItems = useMemo(() => Object.values(library), [library]);

  const filteredItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return libraryItems
      .filter(m => m.categoryIds.includes(activeTab))
      .filter(m => (q ? m.title.toLowerCase().includes(q) : true))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [libraryItems, activeTab, filterText]);

  const handleAddCategory = () => {
    if (newCatName.trim()) {
      const cat = storeActions.addCategory(newCatName.trim());
      setNewCatName("");
      setIsNewCatOpen(false);
      setActiveTab(cat.id);
    }
  };

  const handleRename = () => {
    if (renameOpen && renameValue.trim()) {
      storeActions.renameCategory?.(renameOpen.id, renameValue.trim());
      setRenameOpen(null);
      setRenameValue("");
    }
  };

  return (
    <main className="container mx-auto px-4 pt-3 sm:pt-4 pb-8 max-w-7xl animate-in fade-in duration-300">
      {/* Compact blocky category strip — half the previous height, ~1/4 the width. */}
      <div className="mb-4 sm:mb-6">
        <div
          ref={stripRef}
          className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 hide-scrollbar scroll-smooth"
        >
          {sortedCategories.map((cat) => {
            const count = libraryItems.filter(m => m.categoryIds.includes(cat.id)).length;
            const isActive = activeTab === cat.id;
            const canManage = cat.id !== "default";
            return (
              <div
                key={cat.id}
                ref={(el) => {
                  if (el) tabElsRef.current.set(cat.id, el);
                  else tabElsRef.current.delete(cat.id);
                }}
                className={`group relative rounded-xl border overflow-hidden transition-all shrink-0 w-[96px] sm:w-[112px] ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card hover:bg-muted border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab(cat.id)}
                  className="w-full text-center px-2 py-1.5 sm:py-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer leading-tight"
                >
                  <span className="font-semibold text-xs sm:text-sm truncate w-full">
                    {cat.name}
                  </span>
                  <span className={`text-[10px] sm:text-[11px] ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {count}
                  </span>
                </button>

                {canManage && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Manage ${cat.name}`}
                        className={`absolute top-0.5 right-0.5 p-0.5 rounded transition-opacity ${
                          isActive ? "hover:bg-primary-foreground/20" : "hover:bg-background/80"
                        } opacity-50 group-hover:opacity-100`}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-40 p-1.5" align="end">
                      <div className="flex flex-col">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-start h-9"
                          onClick={() => {
                            setRenameOpen({ id: cat.id, name: cat.name });
                            setRenameValue(cat.name);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-start h-9 text-destructive hover:text-destructive"
                          onClick={() => {
                            storeActions.removeCategory(cat.id);
                            if (activeTab === cat.id) setActiveTab(FALLBACK_TAB);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            );
          })}

          {/* Add-category tile — same compact size as the others. */}
          <button
            type="button"
            onClick={() => setIsNewCatOpen(true)}
            className="shrink-0 w-[96px] sm:w-[112px] rounded-xl border border-dashed border-border bg-card/40 hover:bg-muted hover:border-primary/40 transition-colors flex flex-col items-center justify-center gap-0.5 py-1.5 sm:py-2 text-muted-foreground hover:text-foreground cursor-pointer leading-tight"
            aria-label="New category"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">New</span>
          </button>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-4">
          <LibraryBig className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">
            {filterText ? "No matches" : "Nothing here yet"}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            {filterText
              ? <>No titles in <strong>{activeCatName}</strong> match "{filterText}".</>
              : <>Add titles to <strong>{activeCatName}</strong> from any source.</>
            }
          </p>
          {!filterText && (
            <Link href="/sources">
              <Button>Open Sources</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-5">
          {filteredItems.map(manga => (
            <MangaCard
              key={manga.id}
              manga={manga as any}
              sourceId={(manga as any).sourceId}
              href={(manga as any).sourceId
                ? `/sources/${(manga as any).sourceId}/manga/${manga.id}`
                : `/manga/${manga.id}`}
            />
          ))}
        </div>
      )}

      {/* New category dialog */}
      <Dialog open={isNewCatOpen} onOpenChange={setIsNewCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Category</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input 
              autoFocus
              placeholder="Category name" 
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewCatOpen(false)}>Cancel</Button>
            <Button onClick={handleAddCategory}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={renameOpen !== null} onOpenChange={(open) => !open && setRenameOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Category</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(null)}>Cancel</Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
