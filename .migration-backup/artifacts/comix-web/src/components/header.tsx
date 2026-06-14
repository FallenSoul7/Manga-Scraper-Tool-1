import { Link, useLocation, useSearch } from "wouter";
import { Search, Library, Clock, RefreshCw, Sun, Moon, Laptop, X, Boxes, LayoutGrid, Trash2 } from "lucide-react";
import { Input } from "./ui/input";
import { useEffect, useState } from "react";
import { useUpdatesCount } from "@/hooks/use-updates-count";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { useHistoryHeader } from "@/lib/header-history";

const PAGE_TITLES: Record<string, string> = {
  "/updates": "Updates",
  "/history": "History",
  "/sources": "Sources",
  "/system": "System",
  "/search": "Search",
  "/stats": "Stats",
};

export function Header() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const { totalNew } = useUpdatesCount();
  const theme = useStore(s => s.theme);
  const historyScope = useHistoryHeader();
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const isHome    = location === "/";
  const isUpdates = location === "/updates";
  const isHistory = location === "/history";
  const isSources = location === "/sources";

  const urlQ = isSources ? (new URLSearchParams(searchString).get("q") ?? "") : "";
  const [sourcesQuery, setSourcesQuery] = useState(urlQ);
  useEffect(() => { setSourcesQuery(urlQ); }, [urlQ]);

  const pageTitle = PAGE_TITLES[location] ?? "";
  const showTheme = !isUpdates && !isHistory;

  const handleSourcesSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (sourcesQuery.trim()) {
      setLocation(`/sources?q=${encodeURIComponent(sourcesQuery.trim())}`);
    }
    setIsMobileSearchOpen(false);
  };

  const navLinks = [
    { href: "/", label: "Library", icon: Library },
    { href: "/updates", label: "Updates", icon: RefreshCw, badge: totalNew },
    { href: "/history", label: "History", icon: Clock },
    { href: "/sources", label: "Sources", icon: Boxes },
    { href: "/system", label: "System", icon: LayoutGrid },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-3 sm:px-4 h-11 sm:h-14 flex items-center gap-2 sm:gap-4">

          {/* Logo / page title */}
          {isHome ? (
            <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity shrink-0">
              <Library className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="font-serif font-bold text-base sm:text-xl tracking-tight whitespace-nowrap">
                Library
              </span>
            </Link>
          ) : (
            <span className="font-serif font-bold text-base sm:text-xl tracking-tight whitespace-nowrap shrink-0">
              {pageTitle}
            </span>
          )}

          {/* Desktop nav links */}
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
              );
            })}
          </nav>

          {/* Desktop sources global search */}
          {isSources && (
            <form
              onSubmit={handleSourcesSubmit}
              className="flex-1 max-w-xl mx-auto hidden md:flex items-center gap-2"
            >
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-border select-none text-lg leading-none">│</span>
                <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Global search</span>
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search across all sources…"
                  className="w-full pl-9 pr-9 bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/50 rounded-full"
                  value={sourcesQuery}
                  onChange={e => setSourcesQuery(e.target.value)}
                />
                {sourcesQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setSourcesQuery(""); setLocation("/sources"); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button type="submit" size="icon" variant="ghost" className="h-9 w-9 shrink-0">
                <Search className="h-4 w-4" />
              </Button>
            </form>
          )}

          <div className="flex-1 md:hidden" />

          <div className="flex items-center gap-1 shrink-0">
            {/* Mobile sources search button */}
            {isSources && (
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden h-9 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => setIsMobileSearchOpen(true)}
              >
                <Search className="h-4 w-4" />
                <span>Global search</span>
              </Button>
            )}

            {/* History page actions */}
            {isHistory && historyScope && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                  onClick={historyScope.onSearchClick}
                >
                  <Search className="h-5 w-5" />
                </Button>

                {/* Trash → time-range dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => historyScope.onClearRange("hour")}>
                      The last hour
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => historyScope.onClearRange("day")}>
                      Today
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => historyScope.onClearRange("today-yesterday")}>
                      Today and yesterday
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => historyScope.onClearRange("all")}>
                      All time
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {/* Theme toggle */}
            {showTheme && (
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
            )}
          </div>
        </div>

        {/* Mobile sources search overlay */}
        {isMobileSearchOpen && isSources && (
          <div className="md:hidden border-t bg-background animate-in slide-in-from-top-2 duration-150">
            <form onSubmit={handleSourcesSubmit} className="container mx-auto px-3 py-2 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  type="text"
                  placeholder="Search across all sources…"
                  className="w-full pl-9 pr-9 h-10 bg-muted/50 rounded-full"
                  value={sourcesQuery}
                  onChange={e => setSourcesQuery(e.target.value)}
                />
                {sourcesQuery.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSourcesQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setIsMobileSearchOpen(false)} aria-label="Close search">
                <X className="h-5 w-5" />
              </Button>
            </form>
          </div>
        )}
      </header>

      {/* Mobile bottom nav */}
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
            );
          })}
        </div>
      </nav>
    </>
  );
}
