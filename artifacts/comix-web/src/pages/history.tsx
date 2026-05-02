import { useState, useMemo, useRef, useEffect } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import { isToday, isYesterday, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Trash2, Clock, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type TimePeriod = "last-hour" | "today" | "today-yesterday" | "all";

const PERIOD_LABELS: Record<TimePeriod, string> = {
  "last-hour": "The last hour",
  "today": "Today",
  "today-yesterday": "Today and yesterday",
  "all": "All time",
};

function relativeTime(ts: number): string {
  const date = new Date(ts);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return formatDistanceToNow(date, { addSuffix: true });
}

export default function HistoryPage() {
  const historyKeys = useStore(s => s.history);
  const progressMap = useStore(s => s.progress);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmPeriod, setConfirmPeriod] = useState<TimePeriod | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const historyItems = historyKeys.map(k => progressMap[k]).filter(Boolean);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return historyItems;
    return historyItems.filter(i =>
      i.mangaTitle.toLowerCase().includes(q) ||
      i.chapterTitle?.toLowerCase().includes(q)
    );
  }, [historyItems, query]);

  const handleClear = (period: TimePeriod) => {
    const now = Date.now();
    historyItems.forEach(item => {
      let match = false;
      if (period === "last-hour") match = now - item.updatedAt < 60 * 60 * 1000;
      else if (period === "today") match = isToday(new Date(item.updatedAt));
      else if (period === "today-yesterday") match = isToday(new Date(item.updatedAt)) || isYesterday(new Date(item.updatedAt));
      else match = true;
      if (match) storeActions.markChapterUnread(item.mangaId, item.chapterId);
    });
  };

  return (
    <main className="max-w-2xl mx-auto animate-in fade-in duration-500">

      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        {searchOpen ? (
          <div className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Search history…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="pl-9 pr-9 h-9 bg-muted/40 border-border/60"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => { setSearchOpen(false); setQuery(""); }}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" onClick={() => setSearchOpen(true)}>
              <Search className="h-5 w-5" />
            </Button>
            <div className="flex-1" />
            {historyItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map(p => (
                    <DropdownMenuItem key={p} className="text-destructive focus:text-destructive" onClick={() => setConfirmPeriod(p)}>
                      {PERIOD_LABELS[p]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>

      {/* List */}
      {historyItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-6">
          <Clock className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">No reading history</h3>
          <p className="text-muted-foreground">Your recently read chapters will appear here.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center px-6">
          <p className="text-muted-foreground">No results for "{query}".</p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {filtered.map((item) => (
            <div key={`${item.mangaId}:${item.chapterId}`} className="flex items-center gap-4 px-4 py-3">
              <Link href={`/manga/${item.mangaId}`} className="shrink-0">
                <div className="w-16 h-16 rounded-md overflow-hidden bg-muted shadow-sm">
                  <img
                    src={proxyImage(item.mangaThumbnail)}
                    alt={item.mangaTitle}
                    className="w-full h-full object-cover"
                  />
                </div>
              </Link>

              <div className="flex-1 min-w-0">
                <Link href={`/manga/${item.mangaId}`}>
                  <p className="font-semibold text-base text-foreground leading-snug mb-0.5 hover:text-primary transition-colors line-clamp-2">
                    {item.mangaTitle}
                  </p>
                </Link>
                <p className="text-sm text-muted-foreground truncate mb-1">
                  Chapter {item.chapterNumber}{item.chapterTitle ? `: ${item.chapterTitle}` : ""}
                </p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>{relativeTime(item.updatedAt)}</span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => storeActions.markChapterUnread(item.mangaId, item.chapterId)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Confirm clear dialog */}
      <AlertDialog open={!!confirmPeriod} onOpenChange={open => { if (!open) setConfirmPeriod(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear History</AlertDialogTitle>
            <AlertDialogDescription>
              Remove all history from <strong>{confirmPeriod ? PERIOD_LABELS[confirmPeriod] : ""}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmPeriod(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmPeriod) handleClear(confirmPeriod); setConfirmPeriod(null); }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
