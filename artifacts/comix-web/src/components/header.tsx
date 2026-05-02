import { Link, useLocation } from "wouter";
import { Library, Clock, RefreshCw, Sun, Moon, Boxes, LayoutGrid } from "lucide-react";
import { useUpdatesCount } from "@/hooks/use-updates-count";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

const PAGE_TITLES: Record<string, string> = {
  "/updates": "Updates",
  "/history": "History",
  "/sources": "Sources",
  "/system": "System",
  "/search": "Search",
  "/stats": "Stats",
};

export function Header() {
  const [location] = useLocation();
  const { totalNew } = useUpdatesCount();
  const theme = useStore(s => s.theme);

  const isHome    = location === "/";
  const isUpdates = location === "/updates";
  const isHistory = location === "/history";

  const pageTitle = PAGE_TITLES[location] ?? "";

  const showTheme = !isUpdates && !isHistory;

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

          {/* Logo / page title */}
          {isHome ? (
            <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity shrink-0">
              <Library className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="font-serif font-bold text-base sm:text-xl tracking-tight whitespace-nowrap hidden sm:inline">
                Comix Lounge
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

          <div className="flex-1" />

          <div className="flex items-center gap-1 shrink-0">
            {showTheme && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label="Theme">
                    {theme === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => storeActions.setTheme('light')}>
                    <Sun className="mr-2 h-4 w-4" /> Light
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => storeActions.setTheme('dark')}>
                    <Moon className="mr-2 h-4 w-4" /> Dark
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
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
