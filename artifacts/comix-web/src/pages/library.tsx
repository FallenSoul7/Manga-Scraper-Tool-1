import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useStore, storeActions } from "@/lib/storage";
import { MangaCard } from "@/components/manga-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  LibraryBig, Check, Trash2, AlertTriangle,
  FolderEdit, Globe, X,
} from "lucide-react";
import { useRegisterHeaderSearch } from "@/lib/header-search";

const FALLBACK_TAB = "default";

// ─── Selectable card wrapper ─────────────────────────────────────────────────
// Handles the long-press timer and pointer plumbing entirely so library's JSX
// stays readable.
interface SelectableProps {
  mangaId: string;
  isSelecting: boolean;
  isSelected: boolean;
  selectionModeRef: React.MutableRefObject<boolean>;
  onEnterSelection: (id: string) => void;
  onToggleSelect: (id: string) => void;
  children: React.ReactNode;
}

function SelectableCard({
  mangaId, isSelecting, isSelected, selectionModeRef,
  onEnterSelection, onToggleSelect, children,
}: SelectableProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    startPosRef.current = null;
  };

  return (
    <div
      onPointerDown={(e) => {
        if (isSelecting) return;
        startPosRef.current = { x: e.clientX, y: e.clientY };
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          startPosRef.current = null;
          onEnterSelection(mangaId);
          try { navigator.vibrate(50); } catch {}
        }, 700);
      }}
      onPointerMove={(e) => {
        if (!startPosRef.current) return;
        const dx = e.clientX - startPosRef.current.x;
        const dy = e.clientY - startPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) clear();
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onClick={(e) => {
        if (selectionModeRef.current) {
          e.preventDefault();
          e.stopPropagation();
          onToggleSelect(mangaId);
        }
      }}
      className={`transition-transform duration-150 ${isSelected ? "scale-95" : ""}`}
    >
      {children}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LibraryPage() {
  const library   = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories],
  );

  const catFromUrl = new URLSearchParams(searchString).get("cat");
  const [activeTab, setActiveTabState] = useState<string>(() => {
    if (catFromUrl && (sortedCategories.find(c => c.id === catFromUrl) || catFromUrl === FALLBACK_TAB)) {
      return catFromUrl;
    }
    return sortedCategories[0]?.id ?? FALLBACK_TAB;
  });

  const setActiveTab = (id: string) => {
    setActiveTabState(id);
    setLocation(id === FALLBACK_TAB ? "/" : `/?cat=${id}`, { replace: true });
  };

  const stripRef = useRef<HTMLDivElement>(null);
  const tabElsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!sortedCategories.find(c => c.id === activeTab)) {
      setActiveTab(sortedCategories[0]?.id ?? FALLBACK_TAB);
    }
  }, [sortedCategories, activeTab]);

  useEffect(() => {
    const strip = stripRef.current;
    const el = tabElsRef.current.get(activeTab);
    if (!strip || !el) return;
    const PEEK = 56;
    const stripRect = strip.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const elLeft  = elRect.left  - stripRect.left + strip.scrollLeft;
    const elRight = elRect.right - stripRect.left + strip.scrollLeft;
    let target: number | null = null;
    if (elRight + PEEK > strip.scrollLeft + strip.clientWidth) target = elRight + PEEK - strip.clientWidth;
    else if (elLeft - PEEK < strip.scrollLeft) target = Math.max(0, elLeft - PEEK);
    if (target !== null) strip.scrollTo({ left: target, behavior: "smooth" });
  }, [activeTab]);

  const [filterText, setFilterText] = useState("");
  const activeCatName = sortedCategories.find(c => c.id === activeTab)?.name ?? "library";
  useRegisterHeaderSearch(
    { placeholder: `Filter ${activeCatName}…`, initialQuery: filterText, onChange: q => setFilterText(q) },
    [activeTab, activeCatName],
  );

  const libraryItems = useMemo(() => Object.values(library), [library]);

  const filteredItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return libraryItems
      .filter(m => m.categoryIds.includes(activeTab))
      .filter(m => (q ? m.title.toLowerCase().includes(q) : true))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [libraryItems, activeTab, filterText]);

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode]   = useState(false);
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  // Ref mirrors selectionMode so click-handlers that close over stale state
  // still get the current value without needing to re-bind.
  const selectionModeRef = useRef(false);

  const enterSelection = useCallback((id: string) => {
    selectionModeRef.current = true;
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelection = useCallback(() => {
    selectionModeRef.current = false;
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) {
        // delay exit so the last deselect animation can be seen
        setTimeout(() => {
          selectionModeRef.current = false;
          setSelectionMode(false);
        }, 120);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const allIds = filteredItems.map(m => m.id);
    if (selectedIds.size === allIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  }, [filteredItems, selectedIds]);

  // ── Re-categorize dialog ─────────────────────────────────────────────────────
  const [reCatOpen, setReCatOpen]       = useState(false);
  const [catSelection, setCatSelection] = useState<Set<string>>(new Set());

  const openReCat = useCallback(() => {
    const selected = [...selectedIds].map(id => library[id]).filter(Boolean);
    if (!selected.length) return;
    // Pre-tick categories that EVERY selected manga already has.
    const common = new Set(
      sortedCategories
        .filter(c => selected.every(m => m.categoryIds.includes(c.id)))
        .map(c => c.id),
    );
    setCatSelection(common);
    setReCatOpen(true);
  }, [selectedIds, library, sortedCategories]);

  const applyReCat = useCallback(() => {
    const catIds = [...catSelection];
    // Always ensure at least the "default" category so manga don't vanish.
    const finalCats = catIds.length ? catIds : ["default"];
    storeActions.batchPatchLibrary(
      [...selectedIds].map(mangaId => ({ mangaId, patch: { categoryIds: finalCats } })),
    );
    setReCatOpen(false);
    exitSelection();
  }, [selectedIds, catSelection, exitSelection]);

  const toggleCat = (catId: string) => {
    setCatSelection(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  // ── Source picker dialog ─────────────────────────────────────────────────────
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourceFilter, setSourceFilter]         = useState("");

  const { data: catalogData } = useQuery({
    queryKey: ["sources-catalog"],
    queryFn: async () => {
      const res = await customFetch("/api/sources/catalog");
      return res.json();
    },
    enabled: sourcePickerOpen,
    staleTime: 5 * 60 * 1000,
  });

  const availableSources = useMemo(() => {
    const exts: any[] = catalogData?.extensions ?? [];
    const q = sourceFilter.trim().toLowerCase();
    return exts
      .filter(e => e.supported)
      .filter(e => (q ? (e.name as string).toLowerCase().includes(q) : true));
  }, [catalogData, sourceFilter]);

  const assignSource = useCallback((sourceId: string) => {
    storeActions.batchPatchLibrary(
      [...selectedIds].map(mangaId => ({ mangaId, patch: { sourceId } })),
    );
    setSourcePickerOpen(false);
    setSourceFilter("");
    exitSelection();
  }, [selectedIds, exitSelection]);

  // ── Remove dialog ────────────────────────────────────────────────────────────
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const removeSelected = useCallback(() => {
    for (const id of selectedIds) storeActions.removeFromLibrary(id);
    setConfirmRemoveOpen(false);
    exitSelection();
  }, [selectedIds, exitSelection]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <main className="container mx-auto px-4 pt-0 pb-28 max-w-7xl animate-in fade-in duration-300">
      {/* Category tab strip — Tachiyomi flat-pill style */}
      <div
        ref={stripRef}
        className="flex overflow-x-auto hide-scrollbar border-b border-border/50 mb-4"
      >
        {sortedCategories.map((cat) => {
          const count = libraryItems.filter(m => m.categoryIds.includes(cat.id)).length;
          const isActive = activeTab === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              ref={(el) => {
                if (el) tabElsRef.current.set(cat.id, el as any);
                else tabElsRef.current.delete(cat.id);
              }}
              onClick={() => setActiveTab(cat.id)}
              className={`relative shrink-0 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat.name} {count}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Grid or empty state */}
      {filteredItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-4">
          <LibraryBig className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">
            {filterText ? "No matches" : "Nothing here yet"}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            {filterText
              ? <>No titles in <strong>{activeCatName}</strong> match "{filterText}".</>
              : <>Add titles to <strong>{activeCatName}</strong> from any source.</>}
          </p>
          {!filterText && (
            <Link href="/sources"><Button>Open Sources</Button></Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-5">
          {filteredItems.map(manga => (
            <SelectableCard
              key={manga.id}
              mangaId={manga.id}
              isSelecting={selectionMode}
              isSelected={selectedIds.has(manga.id)}
              selectionModeRef={selectionModeRef}
              onEnterSelection={enterSelection}
              onToggleSelect={toggleSelect}
            >
              <MangaCard
                manga={manga as any}
                sourceId={(manga as any).sourceId}
                href={`/manga/${manga.id}`}
                isSelecting={selectionMode}
                isSelected={selectedIds.has(manga.id)}
              />
            </SelectableCard>
          ))}
        </div>
      )}

      {/* ── Bottom action bar (selection mode) ─────────────────────────────── */}
      {selectionMode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t shadow-xl">
          <div className="container mx-auto max-w-7xl px-3 py-2.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold min-w-[5rem]">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs px-2"
              onClick={toggleSelectAll}
            >
              {selectedIds.size === filteredItems.length ? "Deselect all" : "Select all"}
            </Button>

            <div className="flex-1" />

            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs px-2.5 gap-1.5"
              onClick={openReCat}
            >
              <FolderEdit className="h-3.5 w-3.5" />
              Category
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs px-2.5 gap-1.5"
              onClick={() => { setSourceFilter(""); setSourcePickerOpen(true); }}
            >
              <Globe className="h-3.5 w-3.5" />
              Source
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs px-2.5 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmRemoveOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>

            <Button size="icon" variant="ghost" className="h-8 w-8 ml-1" onClick={exitSelection}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Re-categorize dialog ─────────────────────────────────────────────── */}
      <Dialog open={reCatOpen} onOpenChange={open => { if (!open) setReCatOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Category</DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Applies to {selectedIds.size} selected title{selectedIds.size !== 1 ? "s" : ""}.
            </p>
          </DialogHeader>
          <div className="py-2 flex flex-col gap-1 max-h-64 overflow-y-auto">
            {sortedCategories.map(cat => {
              const checked = catSelection.has(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCat(cat.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    checked ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  }`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    checked ? "bg-primary border-primary" : "border-muted-foreground/40"
                  }`}>
                    {checked && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  {cat.name}
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReCatOpen(false)}>Cancel</Button>
            <Button onClick={applyReCat}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Source picker dialog ──────────────────────────────────────────────── */}
      <Dialog open={sourcePickerOpen} onOpenChange={open => { if (!open) { setSourcePickerOpen(false); setSourceFilter(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Source</DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Sets the source for {selectedIds.size} selected title{selectedIds.size !== 1 ? "s" : ""}. This fixes titles that were saved before a source was stored.
            </p>
          </DialogHeader>
          <div className="py-2 flex flex-col gap-2">
            <Input
              placeholder="Search sources…"
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
              {availableSources.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {catalogData ? "No sources found." : "Loading sources…"}
                </p>
              )}
              {availableSources.map((src: any) => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => assignSource(src.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-left"
                >
                  {src.iconUrl ? (
                    <img src={src.iconUrl} alt={src.name} className="w-6 h-6 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded bg-muted-foreground/20 shrink-0" />
                  )}
                  <span className="flex-1 font-medium">{src.name}</span>
                  <span className="text-xs text-muted-foreground uppercase">{src.language}</span>
                  {src.isNsfw && (
                    <span className="text-[10px] font-semibold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">18+</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSourcePickerOpen(false); setSourceFilter(""); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm remove dialog ────────────────────────────────────────────── */}
      <Dialog open={confirmRemoveOpen} onOpenChange={open => !open && setConfirmRemoveOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remove from library?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will remove {selectedIds.size} title{selectedIds.size !== 1 ? "s" : ""} from your library. Reading progress is kept.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemoveOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={removeSelected}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
