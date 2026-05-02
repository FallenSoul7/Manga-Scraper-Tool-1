import { useState, useMemo } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import { isToday, isYesterday, format, subHours } from "date-fns";
import { Button } from "@/components/ui/button";
import { Trash2, Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

type TimePeriod = "last-hour" | "today" | "today-yesterday" | "all";

const PERIOD_LABELS: Record<TimePeriod, string> = {
  "last-hour": "The last hour",
  "today": "Today",
  "today-yesterday": "Today and yesterday",
  "all": "All time",
};

function timeLabel(ts: number): string {
  const date = new Date(ts);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d, yyyy");
}

export default function HistoryPage() {
  const historyKeys = useStore(s => s.history);
  const progressMap = useStore(s => s.progress);
  const [period, setPeriod] = useState<TimePeriod>("all");

  const historyItems = historyKeys.map(k => progressMap[k]).filter(Boolean);

  const filtered = useMemo(() => {
    const now = Date.now();
    return historyItems.filter(item => {
      if (period === "last-hour") return now - item.updatedAt < 60 * 60 * 1000;
      if (period === "today") return isToday(new Date(item.updatedAt));
      if (period === "today-yesterday") return isToday(new Date(item.updatedAt)) || isYesterday(new Date(item.updatedAt));
      return true;
    });
  }, [historyItems, period]);

  return (
    <main className="max-w-2xl mx-auto animate-in fade-in duration-500">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Select value={period} onValueChange={v => setPeriod(v as TimePeriod)}>
          <SelectTrigger className="h-9 w-48 text-sm bg-muted/40 border-border/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map(p => (
              <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {historyItems.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-5 w-5" />
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

      {/* List */}
      {historyItems.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center px-6">
          <Clock className="h-16 w-16 text-muted mb-6" />
          <h3 className="text-xl font-serif font-bold text-foreground mb-2">No reading history</h3>
          <p className="text-muted-foreground">Your recently read chapters will appear here.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center px-6">
          <p className="text-muted-foreground">No history in this time period.</p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {filtered.map((item) => (
            <div
              key={`${item.mangaId}:${item.chapterId}`}
              className="flex items-center gap-4 px-4 py-3"
            >
              {/* Cover */}
              <Link href={`/manga/${item.mangaId}`} className="shrink-0">
                <div className="w-16 h-16 rounded-md overflow-hidden bg-muted shadow-sm">
                  <img
                    src={proxyImage(item.mangaThumbnail)}
                    alt={item.mangaTitle}
                    className="w-full h-full object-cover"
                  />
                </div>
              </Link>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <Link href={`/manga/${item.mangaId}`}>
                  <p className="font-semibold text-base text-foreground leading-snug mb-0.5 hover:text-primary transition-colors line-clamp-2">
                    {item.mangaTitle}
                  </p>
                </Link>
                <Link href={`/reader/${item.chapterId}?mangaId=${item.mangaId}`}>
                  <p className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate mb-1">
                    Chapter {item.chapterNumber}{item.chapterTitle ? `: ${item.chapterTitle}` : ""}
                  </p>
                </Link>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>{timeLabel(item.updatedAt)}</span>
                </div>
              </div>

              {/* Delete */}
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
    </main>
  );
}
