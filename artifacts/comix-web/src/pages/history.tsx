import { useState } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Trash2, Clock, Trash, Search, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function HistoryPage() {
  const historyKeys = useStore(s => s.history);
  const progressMap = useStore(s => s.progress);
  const [filterText, setFilterText] = useState("");

  const historyItems = historyKeys.map(k => progressMap[k]).filter(Boolean);

  const q = filterText.trim().toLowerCase();
  const filtered = q
    ? historyItems.filter(i => i.mangaTitle.toLowerCase().includes(q) || i.chapterTitle?.toLowerCase().includes(q))
    : historyItems;

  const grouped = filtered.reduce((acc, item) => {
    const date = new Date(item.updatedAt);
    let groupKey = "";
    if (isToday(date)) groupKey = "Today";
    else if (isYesterday(date)) groupKey = "Yesterday";
    else if (Date.now() - item.updatedAt < 7 * 24 * 60 * 60 * 1000) groupKey = format(date, "EEEE");
    else groupKey = format(date, "MMM d, yyyy");

    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(item);
    return acc;
  }, {} as Record<string, typeof historyItems>);

  return (
    <main className="container mx-auto px-4 pt-3 pb-8 max-w-4xl animate-in fade-in duration-500">
      {/* Top row: search + clear all */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter history…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="pl-9 pr-9 h-9"
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

        <div className="flex-1" />

        {historyItems.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4 mr-2" />
                Clear all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear History</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to clear your reading history? This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => storeActions.clearHistory()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {historyItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-4 border rounded-2xl bg-card/50">
          <Clock className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">No reading history</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Your recently read chapters will appear here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center">
          <p className="text-muted-foreground">No history matches "{filterText}".</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([groupKey, items]) => (
            <div key={groupKey} className="space-y-4">
              <h2 className="text-xl font-serif font-bold text-foreground border-b pb-2">{groupKey}</h2>
              <div className="space-y-3">
                {items.map((item) => {
                  const progressPct = item.totalPages > 0 ? (item.lastPageRead / item.totalPages) * 100 : (item.isRead ? 100 : 0);
                  return (
                    <div key={`${item.mangaId}:${item.chapterId}`} className="group flex items-center gap-4 p-3 rounded-xl hover:bg-card transition-colors relative">
                      <Link href={`/manga/${item.mangaId}`} className="shrink-0 cursor-pointer">
                        <div className="w-16 sm:w-20 aspect-[2/3] rounded-md overflow-hidden bg-muted shadow-sm group-hover:opacity-80 transition-opacity">
                          <img
                            src={proxyImage(item.mangaThumbnail)}
                            alt={item.mangaTitle}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </Link>

                      <div className="flex-1 min-w-0 py-1">
                        <Link href={`/manga/${item.mangaId}`}>
                          <h3 className="font-serif font-semibold text-base sm:text-lg mb-0.5 truncate hover:text-primary transition-colors cursor-pointer text-foreground">
                            {item.mangaTitle}
                          </h3>
                        </Link>
                        <Link href={`/reader/${item.chapterId}?mangaId=${item.mangaId}`}>
                          <div className="text-sm font-medium text-foreground hover:text-primary transition-colors cursor-pointer truncate mb-1">
                            Chapter {item.chapterNumber}: {item.chapterTitle || "Read"}
                          </div>
                        </Link>
                        <div className="text-xs text-muted-foreground mb-2">
                          {formatDistanceToNow(item.updatedAt, { addSuffix: true })}
                        </div>
                        {item.totalPages > 0 && (
                          <div className="flex items-center gap-3">
                            <Progress value={progressPct} className="h-1.5 flex-1" />
                            <span className="text-[10px] text-muted-foreground font-medium shrink-0">
                              {item.lastPageRead + 1} / {item.totalPages}
                            </span>
                          </div>
                        )}
                        {!item.totalPages && item.isRead && (
                          <div className="flex items-center gap-3">
                            <Progress value={100} className="h-1.5 flex-1" />
                            <span className="text-[10px] text-muted-foreground font-medium shrink-0">Read</span>
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => storeActions.markChapterUnread(item.mangaId, item.chapterId)}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
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
