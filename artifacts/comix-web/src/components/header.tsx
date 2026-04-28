import { Link, useLocation } from "wouter";
import { Search, Library, Settings, BookOpen, Clock, RefreshCw, Sun, Moon, Laptop, X, Boxes } from "lucide-react";
import { Input } from "./ui/input";
import { useState } from "react";
import { useUpdatesCount } from "@/hooks/use-updates-count";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function Header() {
  const [location, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const { totalNew } = useUpdatesCount();
  const theme = useStore(s => s.theme);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      storeActions.pushSearch(query.trim());
      setLocation(`/search?query=${encodeURIComponent(query.trim())}`);
      setIsMobileSearchOpen(false);
    }
  };

  const navLinks = [
    { href: "/", label: "Browse", icon: BookOpen },
    { href: "/library", label: "Library", icon: Library },
    { href: "/updates", label: "Updates", icon: RefreshCw, badge: totalNew },
    { href: "/history", label: "History", icon: Clock },
    { href: "/sources", label: "Sources", icon: Boxes },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center gap-2 sm:gap-4">
          <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity shrink-0">
            <Library className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="font-serif font-bold text-base sm:text-xl tracking-tight whitespace-nowrap">
              Comix Lounge
            </span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1 mx-4">
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

          <div className="flex-1 max-w-md mx-auto hidden md:block">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search manga..."
                className="w-full pl-9 bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/50 rounded-full"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </form>
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

            <Link href="/settings" className={`p-2 rounded-full transition-colors ${location === '/settings' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} aria-label="Settings">
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>

        {isMobileSearchOpen && (
          <div className="md:hidden border-t bg-background animate-in slide-in-from-top-2 duration-150">
            <form onSubmit={handleSearch} className="container mx-auto px-3 py-2 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  type="search"
                  placeholder="Search manga..."
                  className="w-full pl-9 h-10 bg-muted/50 rounded-full"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
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
