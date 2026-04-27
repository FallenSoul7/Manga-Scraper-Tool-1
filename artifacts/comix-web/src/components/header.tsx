import { Link, useLocation } from "wouter";
import { Search, Library, Settings, BookOpen, Clock, RefreshCw, Sun, Moon, Laptop } from "lucide-react";
import { Input } from "./ui/input";
import { useState, useEffect } from "react";
import { useUpdatesCount } from "@/hooks/use-updates-count";
import { useStore, storeActions, Theme } from "@/lib/storage";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function Header() {
  const [location, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const { totalNew } = useUpdatesCount();
  const theme = useStore(s => s.theme);
  
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      storeActions.pushSearch(query.trim());
      setLocation(`/search?query=${encodeURIComponent(query.trim())}`);
      setIsSearchOpen(false);
    }
  };

  const navLinks = [
    { href: "/", label: "Browse", icon: BookOpen },
    { href: "/library", label: "Library", icon: Library },
    { href: "/updates", label: "Updates", icon: RefreshCw, badge: totalNew },
    { href: "/history", label: "History", icon: Clock },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity">
          <Library className="h-6 w-6" />
          <span className="font-serif font-bold text-xl tracking-tight hidden sm:inline-block">
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

        <div className="flex items-center gap-2">
          <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Search className="h-5 w-5 text-muted-foreground" />
              </Button>
            </DialogTrigger>
            <DialogContent className="top-24 mt-0 mb-auto">
              <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  type="search"
                  placeholder="Search manga..."
                  className="w-full pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </form>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
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

          <Link href="/settings" className={`p-2 rounded-full transition-colors ${location === '/settings' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>
      
      {/* Mobile bottom nav could go here, but for now we put it below header if needed, or just let them use the hamburger/menu. Actually let's add a minimal scrollable nav for mobile below header */}
      <div className="md:hidden border-t overflow-x-auto hide-scrollbar flex items-center px-4 py-2 gap-2 bg-background">
        {navLinks.map((link) => {
          const isActive = location === link.href;
          return (
            <Link 
              key={link.href} 
              href={link.href}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <link.icon className="h-3.5 w-3.5" />
              <span>{link.label}</span>
              {(link.badge ?? 0) > 0 && (
                <span className="ml-1 px-1 rounded-full bg-primary text-[10px] text-primary-foreground leading-tight">
                  {link.badge}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </header>
  );
}
