import { Link, useLocation } from "wouter";
import { Search, Library, Clock, RefreshCw, Sun, Moon, Laptop, X, Boxes, LayoutGrid, SlidersHorizontal, Check } from "lucide-react";
import { Input } from "./ui/input";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUpdatesCount } from "@/hooks/use-updates-count";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useHeaderSearch } from "@/lib/header-search";

const QUERY_DEBOUNCE_MS = 220;

export function Header() {
  const [location, setLocation] = useLocation();
  const scope = useHeaderSearch();
  const [query, setQuery] = useState(scope?.initialQuery ?? "");
  const [tagIds, setTagIds] = useState<string[]>(scope?.initialTagIds ?? []);
  const { totalNew } = useUpdatesCount();
  const theme = useStore(s => s.theme);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  // When the active scope changes (i.e. user navigated to a different page),
  // reset the input/tags to the new scope's defaults so old state doesn't bleed
  // across pages. Tracked by-reference so the user's typing isn't reset on
  // every render of the same scope.
  const lastScopeRef = useRef<typeof scope>(undefined as never);
  useEffect(() => {
    if (scope !== lastScopeRef.current) {
      lastScopeRef.current = scope;
      setQuery(scope?.initialQuery ?? "");
      setTagIds(scope?.initialTagIds ?? []);
    }
  }, [scope]);

  // Debounced typing → scope.onChange. Tag toggles fire immediately (handled
  // in the tag toggle callback) since they're discrete actions.
  useEffect(() => {
    if (!scope) return;
    const id = window.setTimeout(() => {
      scope.onChange(query, tagIds);
    }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope]);

  const toggleTag = (id: string) => {
    setTagIds((prev) => {
      const next = prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id];
      // Fire scope synchronously so the listing updates immediately.
      if (scope) scope.onChange(query, next);
      return next;
    });
  };

  const clearTags = () => {
    setTagIds([]);
    if (scope) scope.onChange(query, []);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scope) {
      // Force the scope to re-evaluate immediately (skip debounce).
      scope.onChange(query, tagIds);
      setIsMobileSearchOpen(false);
      return;
    }
    if (query.trim()) {
      storeActions.pushSearch(query.trim());
      setLocation(`/search?query=${encodeURIComponent(query.trim())}`);
      setIsMobileSearchOpen(false);
    }
  };

  const placeholder = scope?.placeholder ?? "Search manga...";
  const showClear = scope?.showClear !== false && query.length > 0;
  const showFilter = !!(scope?.availableTags && scope.availableTags.length > 0);

  const navLinks = [
    { href: "/", label: "Library", icon: Library },
    { href: "/updates", label: "Updates", icon: RefreshCw, badge: totalNew },
    { href: "/history", label: "History", icon: Clock },
    { href: "/sources", label: "Sources", icon: Boxes },
    { href: "/system", label: "System", icon: LayoutGrid },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center gap-2 sm:gap-4">
          <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity shrink-0">
            <Library className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="font-serif font-bold text-base sm:text-xl tracking-tight whitespace-nowrap hidden sm:inline">
              Comix Lounge
            </span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1 mx-2 lg:mx-4">
            {navLinks.map((link) => {
              const isActive = location === link.href;
              return (
                <Link 
                  key={link.href} 
                  href={link.href}
                  className={`relative flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <link.icon className="h-4 w-4" />
                  <span>{link.label}</span>
                  {(link.badge ?? 0) > 0 && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
                  )}
                </Link>
              )
            })}
          </nav>

          <div className="flex-1 max-w-md mx-auto hidden md:flex items-center gap-2">
            <form onSubmit={handleSubmit} className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={placeholder}
                className="w-full pl-9 pr-9 bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/50 rounded-full"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {showClear && (
                <button
                  type="button"
                  aria-label="Clear"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </form>
            {showFilter && (
              <TagFilterButton
                tags={scope!.availableTags!}
                selectedIds={tagIds}
                onToggle={toggleTag}
                onClear={clearTags}
              />
            )}
          </div>

          <div className="flex-1 md:hidden" />

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={() => setIsMobileSearchOpen(true)}
              aria-label="Search"
            >
              <Search className="h-5 w-5 text-muted-foreground" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label="Theme">
                  {theme === 'light' ? <Sun className="h-5 w-5" /> : theme === 'dark' ? <Moon className="h-5 w-5" /> : <Laptop className="h-5 w-5" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => storeActions.setTheme('light')}>
                  <Sun className="mr-2 h-4 w-4" /> Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => storeActions.setTheme('dark')}>
                  <Moon className="mr-2 h-4 w-4" /> Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => storeActions.setTheme('system')}>
                  <Laptop className="mr-2 h-4 w-4" /> System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isMobileSearchOpen && (
          <div className="md:hidden border-t bg-background animate-in slide-in-from-top-2 duration-150">
            <form onSubmit={handleSubmit} className="container mx-auto px-3 py-2 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  type="search"
                  placeholder={placeholder}
                  className="w-full pl-9 pr-9 h-10 bg-muted/50 rounded-full"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {showClear && (
                  <button
                    type="button"
                    aria-label="Clear"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {showFilter && (
                <TagFilterButton
                  tags={scope!.availableTags!}
                  selectedIds={tagIds}
                  onToggle={toggleTag}
                  onClear={clearTags}
                />
              )}
              <Button type="button" variant="ghost" size="icon" onClick={() => setIsMobileSearchOpen(false)} aria-label="Close search">
                <X className="h-5 w-5" />
              </Button>
            </form>
          </div>
        )}
      </header>

      {/* Mobile bottom nav (fixed) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 border-t">
        <div className="grid grid-cols-5">
          {navLinks.map((link) => {
            const isActive = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <link.icon className="h-5 w-5" />
                <span>{link.label}</span>
                {(link.badge ?? 0) > 0 && (
                  <span className="absolute top-1 right-[28%] min-w-[16px] h-4 px-1 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center leading-none">
                    {link.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  );
}

interface TagFilterButtonProps {
  tags: { id: string; name: string; group?: string; count?: number }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}

function TagFilterButton({ tags, selectedIds, onToggle, onClear }: TagFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Group tags by their `group` field so similar items (Genre, Theme, …)
  // stay together in the picker. Also filter by the in-popover search.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, typeof tags>();
    for (const t of tags) {
      if (q && !t.name.toLowerCase().includes(q)) continue;
      const key = t.group ?? "Tags";
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return Array.from(map.entries());
  }, [tags, search]);

  const selectedCount = selectedIds.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={selectedCount > 0 ? "default" : "outline"}
          size="sm"
          className={`shrink-0 rounded-full h-9 px-3 gap-1.5 ${selectedCount > 0 ? "" : "bg-muted/40"}`}
          aria-label="Filter by tag"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-medium">Filter</span>
          {selectedCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-background/30 text-[11px] font-bold">
              {selectedCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] sm:w-[380px] p-0" sideOffset={8}>
        <div className="p-3 border-b">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Filter by tag</h4>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Find tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-2">
          {grouped.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-6 text-center">No tags match.</div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-3 last:mb-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 mb-1">
                  {group}
                </div>
                <div className="flex flex-wrap gap-1.5 px-1">
                  {items.map((t) => {
                    const active = selectedIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onToggle(t.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors cursor-pointer ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card hover:bg-muted border-border text-foreground"
                        }`}
                      >
                        {active && <Check className="h-3 w-3" />}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
