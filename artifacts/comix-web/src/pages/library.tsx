import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { useStore, storeActions } from "@/lib/storage";
import { MangaCard } from "@/components/manga-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, LibraryBig, MoreHorizontal } from "lucide-react";

const FALLBACK_TAB = "default";

export default function LibraryPage() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories],
  );

  const [activeTab, setActiveTab] = useState<string>(() => sortedCategories[0]?.id ?? FALLBACK_TAB);

  // If the active category gets deleted out from under us, fall back to the
  // first available one so the grid never goes blank.
  useEffect(() => {
    if (!sortedCategories.find(c => c.id === activeTab)) {
      setActiveTab(sortedCategories[0]?.id ?? FALLBACK_TAB);
    }
  }, [sortedCategories, activeTab]);

  const [newCatName, setNewCatName] = useState("");
  const [isNewCatOpen, setIsNewCatOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const libraryItems = useMemo(() => Object.values(library), [library]);

  const filteredItems = useMemo(() => {
    return libraryItems
      .filter(m => m.categoryIds.includes(activeTab))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [libraryItems, activeTab]);

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
    <main className="container mx-auto px-4 pt-4 sm:pt-6 pb-8 max-w-7xl animate-in fade-in duration-300">
      {/* Blocky category strip — sits at the very top, organized as solid tiles. */}
      <div className="mb-6 sm:mb-8">
        <div className="grid grid-flow-col auto-cols-[minmax(120px,1fr)] sm:auto-cols-[minmax(140px,180px)] gap-2 sm:gap-3 overflow-x-auto pb-1 hide-scrollbar">
          {sortedCategories.map((cat) => {
            const count = libraryItems.filter(m => m.categoryIds.includes(cat.id)).length;
            const isActive = activeTab === cat.id;
            const canManage = cat.id !== "default";
            return (
              <div
                key={cat.id}
                className={`group relative rounded-2xl border overflow-hidden transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]"
                    : "bg-card hover:bg-muted border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab(cat.id)}
                  className="w-full text-left px-3 sm:px-4 py-3 sm:py-4 flex flex-col gap-1.5 cursor-pointer"
                >
                  <span className="font-serif font-bold text-base sm:text-lg leading-tight truncate pr-6">
                    {cat.name}
                  </span>
                  <span className={`text-xs ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {count} {count === 1 ? "title" : "titles"}
                  </span>
                </button>

                {canManage && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Manage ${cat.name}`}
                        className={`absolute top-1.5 right-1.5 p-1 rounded-md transition-opacity ${
                          isActive ? "hover:bg-primary-foreground/20" : "hover:bg-background/80"
                        } opacity-60 group-hover:opacity-100`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
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

          {/* Add-category tile */}
          <button
            type="button"
            onClick={() => setIsNewCatOpen(true)}
            className="rounded-2xl border-2 border-dashed border-border bg-card/40 hover:bg-muted hover:border-primary/40 transition-colors flex flex-col items-center justify-center gap-1 px-3 py-3 sm:py-4 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs font-medium">New category</span>
          </button>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-4">
          <LibraryBig className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">Nothing here yet</h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            Add titles to <strong>{sortedCategories.find(c => c.id === activeTab)?.name ?? "this category"}</strong> from any source.
          </p>
          <Link href="/sources">
            <Button>Open Sources</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {filteredItems.map(manga => (
            <MangaCard key={manga.id} manga={manga as any} />
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
