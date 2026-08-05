/**
 * Downloads page — two tabs:
 *   1. "Downloading"    — live queue of chapters being fetched (real progress bars)
 *   2. "Offline Library" — chapters saved to the device for offline reading
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useDownloadQueue, queueActions } from "@/lib/download-queue";
import { useOfflineChapters, offlineDb, formatBytes } from "@/lib/offline-db";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft, Loader2, Pause, Play, Zap,
  ArrowUp, ArrowDown, X, MoreVertical,
  BookOpen, Trash2, HardDrive, WifiOff,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { proxyImage } from "@/lib/utils";
import { format } from "date-fns";

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-1 w-full rounded-full bg-muted overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'downloading') return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
      <Loader2 className="h-3 w-3 animate-spin" /> Downloading
    </span>
  );
  if (status === 'paused') return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-500">
      <Pause className="h-3 w-3" /> Paused
    </span>
  );
  if (status === 'error') return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-destructive">
      <AlertCircle className="h-3 w-3" /> Error
    </span>
  );
  if (status === 'done') return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-green-500">
      <CheckCircle2 className="h-3 w-3" /> Done
    </span>
  );
  return <span className="text-[11px] font-semibold text-muted-foreground">Queued</span>;
}

// ─── Downloading tab ──────────────────────────────────────────────────────────

function DownloadingTab() {
  const items      = useDownloadQueue(s => s.items);
  const paused     = useDownloadQueue(s => s.globalPaused);
  const concurrent = useDownloadQueue(s => s.concurrentCount);

  const active = items.filter(i => ['queued', 'downloading', 'paused'].includes(i.status));
  const done   = items.filter(i => i.status === 'done' || i.status === 'error');

  const totalActive    = active.length;
  const downloadingNow = items.filter(i => i.status === 'downloading').length;

  return (
    <div className="space-y-4">
      {/* ── Controls ── */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => queueActions.togglePause()}
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-full bg-primary/12 text-primary font-semibold text-sm hover:bg-primary/20 active:scale-95 transition-all"
        >
          {paused
            ? <><Play  className="h-4 w-4 fill-current" /> Resume all</>
            : <><Pause className="h-4 w-4 fill-current" /> Pause all</>
          }
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-full bg-primary/12 text-primary font-semibold text-sm hover:bg-primary/20 active:scale-95 transition-all"
            >
              <Zap className="h-4 w-4 fill-current" />
              {concurrent} at a time
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-44">
            {[1, 2, 3, 4, 5].map(n => (
              <DropdownMenuItem
                key={n}
                onClick={() => queueActions.setConcurrent(n)}
                className={concurrent === n ? "text-primary font-semibold" : ""}
              >
                {n} {n === 1 ? "chapter" : "chapters"} at once
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Live status ── */}
      {totalActive > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
          <span>
            {downloadingNow > 0
              ? `Downloading ${downloadingNow} of ${totalActive} chapters`
              : paused ? `${totalActive} chapters paused` : `${totalActive} chapters queued`
            }
          </span>
        </div>
      )}

      {/* ── Active queue ── */}
      {active.length > 0 && (
        <div className="space-y-2">
          {active.map((item, idx) => {
            const isFirst = idx === 0;
            const isLast  = idx === active.length - 1;
            const pages   = item.pagesTotal > 0
              ? `${item.pagesDownloaded} / ${item.pagesTotal} pages`
              : item.status === 'queued' ? 'Waiting…' : 'Fetching page list…';

            return (
              <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-card border border-border/50 p-3">
                <img
                  src={proxyImage(item.mangaThumbnail, item.sourceId)}
                  alt={item.mangaTitle}
                  className="h-16 w-12 rounded-xl object-cover shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="font-semibold text-sm truncate leading-tight">{item.mangaTitle}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    Ch.{item.chapterNumber}{item.chapterTitle ? ` · ${item.chapterTitle}` : ''}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-[11px] text-muted-foreground tabular-nums">{pages}</span>
                  </div>
                  <ProgressBar value={item.progress} />
                </div>

                {/* 3-dot menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {/* Pause / Resume */}
                    {item.status === 'paused' ? (
                      <DropdownMenuItem onClick={() => queueActions.resumeItem(item.id)}>
                        <Play className="h-4 w-4 mr-2" /> Resume
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => queueActions.pauseItem(item.id)}>
                        <Pause className="h-4 w-4 mr-2" /> Pause
                      </DropdownMenuItem>
                    )}

                    {/* Move Up — hidden for first item */}
                    {!isFirst && (
                      <DropdownMenuItem onClick={() => queueActions.moveUp(item.id)}>
                        <ArrowUp className="h-4 w-4 mr-2" /> Move up
                      </DropdownMenuItem>
                    )}

                    {/* Move Down — hidden for last item */}
                    {!isLast && (
                      <DropdownMenuItem onClick={() => queueActions.moveDown(item.id)}>
                        <ArrowDown className="h-4 w-4 mr-2" /> Move down
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => queueActions.remove(item.id)}
                    >
                      <X className="h-4 w-4 mr-2" /> Cancel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Completed / errored ── */}
      {done.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Completed
            </span>
            <button
              type="button"
              onClick={() => queueActions.clearDone()}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          </div>
          {done.map(item => (
            <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-card border border-border/30 p-3 opacity-60">
              <img
                src={proxyImage(item.mangaThumbnail, item.sourceId)}
                alt={item.mangaTitle}
                className="h-12 w-9 rounded-lg object-cover shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{item.mangaTitle}</div>
                <div className="text-xs text-muted-foreground truncate">Ch.{item.chapterNumber}</div>
              </div>
              <StatusBadge status={item.status} />
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {active.length === 0 && done.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <div className="text-4xl select-none">( •_•)</div>
          <div className="text-sm">No downloads in progress</div>
          <div className="text-xs text-center max-w-[200px] text-muted-foreground/70">
            Tap the download icon next to any chapter to start
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Offline Library tab ──────────────────────────────────────────────────────

function OfflineLibraryTab() {
  const [, setLocation] = useLocation();
  const chapters = useOfflineChapters();
  const [deleting, setDeleting] = useState<string | null>(null);

  const totalBytes = chapters.reduce((sum, c) => sum + (c.sizeBytes || 0), 0);

  async function handleDelete(chapterId: string) {
    const chapter = chapters.find(c => c.chapterId === chapterId);
    if (!chapter) return;
    setDeleting(chapterId);
    try {
      await offlineDb.deleteWithPages(chapter);
    } finally {
      setDeleting(null);
    }
  }

  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <WifiOff className="h-10 w-10 opacity-30" />
        <div className="text-sm font-medium">No offline chapters saved</div>
        <div className="text-xs text-center max-w-[220px] text-muted-foreground/70">
          Download chapters to "App" to read them without an internet connection
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Storage summary */}
      <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <HardDrive className="h-4 w-4 shrink-0" />
        <span>{chapters.length} chapter{chapters.length !== 1 ? 's' : ''} · {formatBytes(totalBytes)} used</span>
      </div>

      {/* Chapter list */}
      <div className="space-y-2">
        {chapters.map(chapter => (
          <div
            key={chapter.chapterId}
            className="flex items-center gap-3 rounded-2xl bg-card border border-border/50 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => {
              setLocation(
                `/reader/${chapter.chapterId}?mangaId=${chapter.mangaId}&sourceId=${chapter.sourceId}&offline=1`
              );
            }}
          >
            <img
              src={proxyImage(chapter.mangaThumbnail, chapter.sourceId)}
              alt={chapter.mangaTitle}
              className="h-16 w-12 rounded-xl object-cover shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate leading-tight">{chapter.mangaTitle}</div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                Ch.{chapter.chapterNumber}{chapter.chapterTitle ? ` · ${chapter.chapterTitle}` : ''}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="flex items-center gap-1 text-[11px] font-semibold text-green-500">
                  <WifiOff className="h-3 w-3" /> Available offline
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {chapter.pageUrls.length} pages
                  {chapter.sizeBytes ? ` · ${formatBytes(chapter.sizeBytes)}` : ''}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className="text-[11px] text-muted-foreground">
                {format(new Date(chapter.downloadedAt), 'MMM d')}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="h-8 w-8 flex items-center justify-center rounded-full text-primary hover:bg-primary/10 transition-colors"
                  title="Read offline"
                  onClick={e => {
                    e.stopPropagation();
                    setLocation(
                      `/reader/${chapter.chapterId}?mangaId=${chapter.mangaId}&sourceId=${chapter.sourceId}&offline=1`
                    );
                  }}
                >
                  <BookOpen className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={deleting === chapter.chapterId}
                  className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                  title="Delete offline copy"
                  onClick={e => { e.stopPropagation(); handleDelete(chapter.chapterId); }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DownloadsPage() {
  const [, setLocation] = useLocation();
  const activeCount = useDownloadQueue(
    s => s.items.filter(i => ['queued', 'downloading', 'paused'].includes(i.status)).length
  );

  return (
    <main className="min-h-screen bg-background text-foreground">

      {/* ── Header ── */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border/50">
        <div className="flex items-center gap-3 px-3 h-14">
          <Button
            variant="ghost" size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setLocation("/system")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-serif font-bold text-xl tracking-tight flex-1">Downloads</h1>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="max-w-2xl mx-auto px-4 pt-4 pb-8">
        <Tabs defaultValue="downloading">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="downloading" className="flex-1 gap-1.5">
              Downloading
              {activeCount > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                  {activeCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="offline" className="flex-1">
              Offline Library
            </TabsTrigger>
          </TabsList>

          <TabsContent value="downloading" className="mt-0">
            <DownloadingTab />
          </TabsContent>
          <TabsContent value="offline" className="mt-0">
            <OfflineLibraryTab />
          </TabsContent>
        </Tabs>
      </div>

    </main>
  );
}
