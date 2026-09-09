import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BookOpen, HardDrive, Trash2, WifiOff } from "lucide-react";
import { proxyImage } from "@/lib/utils";
import { useOfflineChapters, offlineDb, formatBytes } from "@/lib/offline-db";
import { readerUrl } from "@/lib/utils";

export default function DownloadsLibraryPage() {
  const [, setLocation] = useLocation();
  const chapters = useOfflineChapters();
  const [deleting, setDeleting] = useState<string | null>(null);

  const groups = useMemo(() => {
    const grouped = new Map<string, typeof chapters>();
    for (const chapter of chapters) {
      grouped.set(chapter.mangaId, [...(grouped.get(chapter.mangaId) ?? []), chapter]);
    }
    return Array.from(grouped.entries())
      .map(([mangaId, items]) => ({
        mangaId,
        chapters: items.sort((a, b) => b.downloadedAt - a.downloadedAt),
      }))
      .sort((a, b) => (b.chapters[0]?.downloadedAt ?? 0) - (a.chapters[0]?.downloadedAt ?? 0));
  }, [chapters]);

  const deleteChapter = async (chapter: typeof chapters[number]) => {
    setDeleting(chapter.chapterId);
    try { await offlineDb.deleteWithPages(chapter); }
    finally { setDeleting(null); }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">

      {/* ── Header ── */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border/50">
        <div className="flex items-center gap-3 px-3 h-14">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setLocation("/downloads")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-serif font-bold text-xl tracking-tight">Downloaded</h1>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground px-6">
          <WifiOff className="h-10 w-10 opacity-30" />
          <div className="text-sm text-center">
            No downloaded manga yet.<br />Download chapters from any manga page to read it offline.
          </div>
        </div>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
          {groups.map(({ mangaId, chapters: mangaChapters }) => {
            const first = mangaChapters[0]!;
            return (
              <section key={mangaId} className="rounded-2xl border border-border/50 bg-card overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setLocation(`/manga/${encodeURIComponent(mangaId)}`)}
                >
                  <img src={proxyImage(first.mangaThumbnail, first.sourceId)} alt={first.mangaTitle} className="h-20 w-14 rounded-xl object-cover shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{first.mangaTitle}</div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-green-500 font-semibold"><WifiOff className="h-3 w-3" /> Available offline</div>
                    <div className="text-xs text-muted-foreground mt-1">{mangaChapters.length} downloaded chapter{mangaChapters.length !== 1 ? "s" : ""}</div>
                  </div>
                  <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
                <div className="border-t border-border/40 divide-y divide-border/30">
                  {mangaChapters.map(chapter => (
                    <div key={chapter.chapterId} className="flex items-center gap-2 px-3 py-2.5">
                      <button type="button" className="flex-1 min-w-0 text-left hover:text-primary" onClick={() => setLocation(readerUrl(chapter.chapterId, chapter.mangaId, chapter.sourceId, true))}>
                        <div className="text-sm font-medium truncate">Chapter {chapter.chapterNumber}{chapter.chapterTitle ? ` · ${chapter.chapterTitle}` : ""}</div>
                        <div className="text-[11px] text-muted-foreground">{chapter.pageUrls.length} pages{chapter.sizeBytes ? ` · ${formatBytes(chapter.sizeBytes)}` : ""}</div>
                      </button>
                      <button type="button" className="h-8 w-8 flex items-center justify-center rounded-full text-primary hover:bg-primary/10" title="Read offline" onClick={() => setLocation(readerUrl(chapter.chapterId, chapter.mangaId, chapter.sourceId, true))}>
                        <BookOpen className="h-4 w-4" />
                      </button>
                      <button type="button" disabled={deleting === chapter.chapterId} className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive disabled:opacity-40" title="Delete offline copy" onClick={() => deleteChapter(chapter)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
