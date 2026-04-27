import { Link, useLocation } from "wouter";
import { Search, Library, Settings } from "lucide-react";
import { Input } from "./ui/input";
import { useState } from "react";

export function Header() {
  const [_, setLocation] = useLocation();
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setLocation(`/search?query=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity">
          <Library className="h-6 w-6" />
          <span className="font-serif font-bold text-xl tracking-tight hidden sm:inline-block">
            Comix Lounge
          </span>
        </Link>
        
        <div className="flex-1 max-w-md mx-auto">
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search manga or paste URL..."
              className="w-full pl-9 bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/50 rounded-full"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
        </div>

        <nav className="flex items-center gap-2">
          <Link href="/settings" className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Settings className="h-5 w-5" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
