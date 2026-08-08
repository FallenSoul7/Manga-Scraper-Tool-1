import { useEffect, useRef, useState } from "react";
import { useStore, storeActions } from "@/lib/storage";
import type { ChapterProgress } from "@/lib/storage";
import { Link } from "wouter";
import { proxyImage, readerUrl } from "@/lib/utils";
import { formatDistanceToNow, isToday, isYesterday, isThisWeek } from "date-fns";
import { BookOpen, Clock, Film, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { registerHistoryHeader } from "@/lib/header-history";

type DateGroup = "Today" | "Yesterday" | "This Week" | "Older";

function getGroup(ts: number): DateGroup {
  const d = new Date(ts);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (isThisWeek(d)) return "This Week";
  return "Older";
}

function isVideoItem(item: ChapterProgress) {
  // Only detect as video when the title explicitly signals it —
  // never use page count, since single-page manga chapters are common.
  return (
    /\b(episode|season|s\d+e\d+|video|stream|watch)\b/i.test(item.chapterTitle ?? "") ||
    /\b(episode|season|s\d+e\d+)\b/i.test(item.mangaTitle ?? "")
  );
}

export default function HistoryPage() {
  const historyKeys = useStore(s => s.history);
  const progressMap = useStore(s => s.progress);
  const library = useStore(s => s.library);
  const [filterText, setFilterText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const historyItems = historyKeys.map(k => progressMap[k]).filter(Boolean);

  const q = filterText.trim().toLowerCase();
  const filtered = q
    ? historyItems.filter(i =>
        i.mangaTitle.toLowerCase().includes(q) ||
        (i.chapterTitle ?? "").toLowerCase().includes(q)
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

  // Group items by date
  const groups: { label: DateGroup; items: ChapterProgress[] }[] = [];
  const seen = new Set<DateGroup>();
  for (const item of filtered) {
    const g = getGroup(item.updatedAt);
    if (!seen.has(g)) {
      seen.add(g);
      groups.push({ label: g, items: [] });
    }
    groups[groups.length - 1].items.push(item);
  }
  // Ensure groups are in correct order
  const ORDER: DateGroup[] = ["Today", "Yesterday", "This Week", "Older"];
  const sortedGroups = ORDER
    .map(label => groups.find(g => g.label === label))
    .filter((g): g is NonNullable<typeof g> => !!g);

  return (
    <main className="pb-8 animate-in fade-in duration-300">

      {/* Inline search bar */}
      {searchOpen && (
        <div className="px-4 pt-3 pb-1 animate-in slide-in-from-top-1 duration-150">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search history…"
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
        <div className="py-24 flex flex-col items-center justify-center text-center px-8 gap-4">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">No history yet</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Manga and videos you read will appear here.
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center px-4">
          <p className="text-muted-foreground text-sm">No history matches "{filterText}".</p>
        </div>
      ) : (
        <div>
          {sortedGroups.map(({ label, items }) => (
            <div key={label}>
              {/* Date group header */}
              <div className="px-4 pt-5 pb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {label}
                </span>
              </div>

              <div className="divide-y divide-border/30">
                {items.map((item) => {
                  const isVideo = isVideoItem(item);
                  const sid = library[item.mangaId]?.sourceId;
                  const readerHref = readerUrl(item.chapterId, item.mangaId, sid);
                  const progressPct = item.totalPages > 1
                    ? Math.min(100, Math.round((item.lastPageRead / item.totalPages) * 100))
                    : item.isRead ? 100 : 0;

                  return (
                    <div
                      key={`${item.mangaId}:${item.chapterId}`}
                      className="flex items-center gap-3 px-4 py-2.5 group"
                    >
                      {/* Cover — links to manga/anime detail */}
                      <Link href={`/manga/${item.mangaId}`} className="shrink-0">
                        <div className="relative w-[60px] h-[80px] rounded-lg overflow-hidden bg-muted shadow-sm">
                          <img
                            src={proxyImage(item.mangaThumbnail)}
                            alt={item.mangaTitle}
                            className="w-full h-full object-cover"
                          />
                          {/* Video badge */}
                          {isVideo && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Film className="h-5 w-5 text-white drop-shadow" />
                            </div>
                          )}
                          {/* Progress bar */}
                          {progressPct > 0 && progressPct < 100 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          )}
                          {/* Read checkmark */}
                          {item.isRead && (
                            <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary/90 flex items-center justify-center">
                              <BookOpen className="h-2.5 w-2.5 text-primary-foreground" />
                            </div>
                          )}
                        </div>
                      </Link>

                      {/* Info — links to reader */}
                      <Link href={readerHref} className="flex-1 min-w-0 py-0.5">
                        <p className="font-semibold text-[14px] leading-snug text-foreground line-clamp-1 mb-0.5">
                          {item.mangaTitle}
                        </p>
                        <p className="text-sm text-muted-foreground truncate mb-1">
                          {isVideo ? "Episode" : "Chapter"} {item.chapterNumber}
                          {item.chapterTitle ? `: ${item.chapterTitle}` : ""}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 shrink-0" />
                            {formatDistanceToNow(item.updatedAt, { addSuffix: true })}
                          </span>
                          {item.totalPages > 1 && !item.isRead && (
                            <span className="text-primary font-medium">
                              p.{item.lastPageRead}/{item.totalPages}
                            </span>
                          )}
                          {item.isRead && (
                            <span className="text-muted-foreground/60">Finished</span>
                          )}
                        </div>
                      </Link>

                      {/* Delete */}
                      <button
                        type="button"
                        className="shrink-0 p-2 text-muted-foreground/40 hover:text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                        onClick={() => storeActions.removeFromHistory(item.mangaId, Number(item.chapterId))}
                        title="Remove from history"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
