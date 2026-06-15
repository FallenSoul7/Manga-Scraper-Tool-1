import { useEffect, useRef, useState } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Clock, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { registerHistoryHeader } from "@/lib/header-history";

export default function HistoryPage() {
  const historyKeys = useStore(s => s.history);
  const progressMap = useStore(s => s.progress);
  const [filterText, setFilterText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const historyItems = historyKeys.map(k => progressMap[k]).filter(Boolean);

  const q = filterText.trim().toLowerCase();
  const filtered = q
    ? historyItems.filter(i =>
        i.mangaTitle.toLowerCase().includes(q) ||
        i.chapterTitle?.toLowerCase().includes(q)
      )
    : historyItems;

  const handleClearRange = (range: "hour" | "day" | "today-yesterday" | "all") => {
    if (range === "all") {
      storeActions.clearHistory();
    } else if (range === "hour") {
      storeActions.clearHistoryBefore(Date.now() - 60 * 60 * 1000);
    } else if (range === "today-yesterday") {
      const startOfYesterday = new Date();
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      startOfYesterday.setHours(0, 0, 0, 0);
      storeActions.clearHistoryBefore(startOfYesterday.getTime());
    } else {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      storeActions.clearHistoryBefore(startOfToday.getTime());
    }
  };

  useEffect(() => {
    registerHistoryHeader({
      onSearchClick: () => {
        setSearchOpen(o => {
          if (!o) setTimeout(() => searchInputRef.current?.focus(), 50);
          return !o;
        });
      },
      onClearRange: handleClearRange,
    });
    return () => registerHistoryHeader(null);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <main className="pb-8 animate-in fade-in duration-500">

      {/* Inline search bar */}
      {searchOpen && (
        <div className="px-4 pt-3 pb-1 animate-in slide-in-from-top-1 duration-150">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Filter history…"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              className="pl-9 pr-9 h-10"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {historyItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-8">
          <Clock className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No reading history</h3>
          <p className="text-sm text-muted-foreground">
            Your recently read chapters will appear here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center px-4">
          <p className="text-muted-foreground text-sm">No history matches "{filterText}".</p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {filtered.map((item) => (
            <div
              key={`${item.mangaId}:${item.chapterId}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              {/* Cover thumbnail — square, links to manga detail */}
              <Link href={`/manga/${item.mangaId}`} className="shrink-0">
                <div className="w-[72px] h-[72px] rounded-md overflow-hidden bg-muted shadow-sm">
                  <img
                    src={proxyImage(item.mangaThumbnail)}
                    alt={item.mangaTitle}
                    className="w-full h-full object-cover"
                  />
                </div>
              </Link>

              {/* Text info — links to reader */}
              <Link
                href={`/reader/${item.chapterId}?mangaId=${item.mangaId}`}
                className="flex-1 min-w-0 py-0.5"
              >
                <p className="font-semibold text-[15px] leading-snug text-foreground line-clamp-2 mb-0.5">
                  {item.mangaTitle}
                </p>
                <p className="text-sm text-muted-foreground truncate mb-1">
                  Chapter {item.chapterNumber}{item.chapterTitle ? `: ${item.chapterTitle}` : ""}
                </p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>{formatDistanceToNow(item.updatedAt, { addSuffix: true })}</span>
                </div>
              </Link>

              {/* Per-item delete */}
              <button
                type="button"
                className="shrink-0 p-2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => storeActions.removeFromHistory(item.mangaId, Number(item.chapterId))}
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
