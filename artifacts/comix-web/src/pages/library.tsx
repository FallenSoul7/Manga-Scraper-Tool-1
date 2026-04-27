import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useStore, storeActions } from "@/lib/storage";
import { MangaCard } from "@/components/manga-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Library, Search, MoreVertical, Plus, CheckSquare, Trash2, LibraryBig } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

export default function LibraryPage() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const progress = useStore(s => s.progress);
  
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState("added-desc");
  const [editMode, setEditMode] = useState(false);
  const [selectedManga, setSelectedManga] = useState<Set<string>>(new Set());

  const [newCatName, setNewCatName] = useState("");
  const [isNewCatOpen, setIsNewCatOpen] = useState(false);

  const libraryItems = useMemo(() => Object.values(library), [library]);

  const filteredItems = useMemo(() => {
    let items = libraryItems;
    if (activeTab !== "all") {
      items = items.filter(m => m.categoryIds.includes(activeTab));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(m => m.title.toLowerCase().includes(q));
    }
    
    // Sort
    items.sort((a, b) => {
      if (sort === "title-asc") return a.title.localeCompare(b.title);
      if (sort === "title-desc") return b.title.localeCompare(a.title);
      if (sort === "added-desc") return b.addedAt - a.addedAt;
      if (sort === "added-asc") return a.addedAt - b.addedAt;
      return 0;
    });
    
    return items;
  }, [libraryItems, activeTab, searchQuery, sort]);

  const handleAddCategory = () => {
    if (newCatName.trim()) {
      const cat = storeActions.addCategory(newCatName.trim());
      setNewCatName("");
      setIsNewCatOpen(false);
      setActiveTab(cat.id);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedManga);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedManga(next);
  };

  const getUnreadCount = (mangaId: string, totalSeen: number) => {
    // This is a naive calculation. A real calculation needs total chapters fetched or we just check progress.
    // For now we check if there are read chapters vs seen.
    return 0;
  };

  return (
    <main className="container mx-auto px-4 py-8 max-w-7xl animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-2">Your Library</h1>
        <p className="text-muted-foreground text-lg">{libraryItems.length} titles saved</p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-4 hide-scrollbar">
        <Button 
          variant={activeTab === "all" ? "default" : "outline"}
          onClick={() => setActiveTab("all")}
          className="rounded-full rounded-r-none whitespace-nowrap"
        >
          All
          <span className="ml-2 bg-background/20 text-current px-2 py-0.5 rounded-full text-xs">
            {libraryItems.length}
          </span>
        </Button>
        {categories.map((cat) => {
          const count = libraryItems.filter(m => m.categoryIds.includes(cat.id)).length;
          return (
            <Popover key={cat.id}>
              <PopoverTrigger asChild>
                <Button 
                  variant={activeTab === cat.id ? "default" : "outline"}
                  onClick={() => setActiveTab(cat.id)}
                  className="rounded-none whitespace-nowrap"
                >
                  {cat.name}
                  <span className="ml-2 bg-background/20 text-current px-2 py-0.5 rounded-full text-xs">
                    {count}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-2">
                <div className="flex flex-col gap-1">
                  {cat.id !== "default" && (
                    <>
                      <Button variant="ghost" size="sm" className="justify-start">Rename</Button>
                      <Button variant="ghost" size="sm" className="justify-start text-destructive" onClick={() => {
                        storeActions.removeCategory(cat.id);
                        if (activeTab === cat.id) setActiveTab("all");
                      }}>Delete</Button>
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
        <Button variant="outline" className="rounded-full rounded-l-none" onClick={() => setIsNewCatOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Filter library..." 
            className="pl-9"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title-asc">Title (A-Z)</SelectItem>
              <SelectItem value="title-desc">Title (Z-A)</SelectItem>
              <SelectItem value="added-desc">Recently Added</SelectItem>
              <SelectItem value="added-asc">Oldest Added</SelectItem>
            </SelectContent>
          </Select>

          <Button 
            variant={editMode ? "secondary" : "outline"} 
            onClick={() => {
              setEditMode(!editMode);
              if (editMode) setSelectedManga(new Set());
            }}
          >
            {editMode ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>

      {editMode && selectedManga.size > 0 && (
        <div className="sticky top-20 z-10 bg-card border rounded-xl p-4 mb-6 shadow-md flex items-center justify-between animate-in slide-in-from-top-4">
          <div className="font-medium">{selectedManga.size} selected</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline">Move</Button>
            <Button size="sm" variant="destructive" onClick={() => {
              selectedManga.forEach(id => storeActions.removeFromLibrary(id));
              setSelectedManga(new Set());
              setEditMode(false);
            }}>Remove</Button>
          </div>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-4">
          <LibraryBig className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">Your library is empty</h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            Browse our collection to add your first title to your personal reading space.
          </p>
          <Link href="/">
            <Button>Browse Manga</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {filteredItems.map(manga => {
            const unread = getUnreadCount(manga.id, manga.lastChapterCountSeen);
            return (
              <div key={manga.id} className="relative">
                {editMode && (
                  <div className="absolute top-2 left-2 z-10">
                    <Checkbox 
                      checked={selectedManga.has(manga.id)}
                      onCheckedChange={() => toggleSelect(manga.id)}
                      className="bg-background/80 backdrop-blur"
                    />
                  </div>
                )}
                {unread > 0 && !editMode && (
                  <Badge variant="default" className="absolute top-2 left-2 z-10">{unread}</Badge>
                )}
                <div onClick={(e) => {
                  if (editMode) {
                    e.preventDefault();
                    toggleSelect(manga.id);
                  }
                }}>
                  <MangaCard manga={manga as any} />
                </div>
              </div>
            );
          })}
        </div>
      )}

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
            <Button onClick={handleAddCategory}>Add Category</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
