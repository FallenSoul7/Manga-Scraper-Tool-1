import { useState } from "react";
import { useLocation } from "wouter";
import { useDownloadQueue, queueActions } from "@/lib/download-queue";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Loader2, Pause, Play, Zap, ChevronDown, ChevronUp,
  ArrowUp, ArrowDown, X, MoreVertical,
} from "lucide-react";
import { proxyImage } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full rounded-full bg-muted overflow-hidden mt-2">
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

export default function DownloadsPage() {
  const [, setLocation] = useLocation();
  const items         = useDownloadQueue(s => s.items);
  const paused        = useDownloadQueue(s => s.paused);
  const concurrent    = useDownloadQueue(s => s.concurrentCount);
  const [recentOpen, setRecentOpen] = useState(true);

  const active = items.filter(i => i.status === 'queued' || i.status === 'downloading');
  const done   = items.filter(i => i.status === 'done');
  const total  = active.length;
  const downloading = items.filter(i => i.status === 'downloading').length;

  return (
    <main className="min-h-screen bg-background text-foreground">

      {/* ── Header ── */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border/50">
        <div className="flex items-center gap-3 px-3 h-14">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => window.history.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>

          {/* Clicking the title takes you to the downloaded-manga list */}
          <button
            type="button"
            className="flex-1 text-left font-serif font-bold text-xl tracking-tight hover:text-primary transition-colors"
            onClick={() => setLocation("/downloads/library")}
          >
            Downloads
          </button>
        </div>

        {/* Status bar */}
        {total > 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 text-sm text-muted-foreground border-t border-border/30">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-primary" />
            <span>Downloading {downloading} of {total}</span>
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* ── Pause / Concurrent controls ── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => queueActions.togglePause()}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full bg-primary/15 text-primary font-semibold text-sm hover:bg-primary/25 transition-colors active:scale-95"
          >
            {paused
              ? <><Play  className="h-4 w-4 fill-current" /> Resume</>
              : <><Pause className="h-4 w-4 fill-current" /> Pause</>
            }
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex-1 flex items-center justify-center gap-2 h-11 rounded-full bg-primary/15 text-primary font-semibold text-sm hover:bg-primary/25 transition-colors active:scale-95"
              >
                <Zap className="h-4 w-4 fill-current" />
                Concurrent downloads: {concurrent}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-48">
              {[1, 2, 3, 4, 5].map(n => (
                <DropdownMenuItem
                  key={n}
                  onClick={() => queueActions.setConcurrent(n)}
                  className={concurrent === n ? "text-primary font-semibold" : ""}
                >
                  {n} {n === 1 ? "download" : "downloads"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── Active queue ── */}
        {active.length === 0 && done.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <div className="text-4xl">( •_•)</div>
            <div className="text-sm">No downloads queued</div>
            <Button variant="outline" size="sm" onClick={() => setLocation("/sources")}>
              Browse sources
            </Button>
          </div>
        ) : (
          <>
            {active.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-card border border-border/50 p-3">
                <img
                  src={proxyImage(item.mangaThumbnail, item.sourceId)}
                  alt={item.mangaTitle}
                  className="h-16 w-12 rounded-xl object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{item.mangaTitle}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    Chapter {item.chapterNumber}{item.chapterTitle ? `: ${item.chapterTitle}` : ""}
                  </div>
                  <ProgressBar value={item.progress} />
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs font-semibold tabular-nums text-primary">
                    {Math.round(item.progress)}%
                  </span>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => queueActions.moveUp(item.id)}
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === active.length - 1}
                      onClick={() => queueActions.moveDown(item.id)}
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => queueActions.remove(item.id)}
                        >
                          <X className="h-4 w-4 mr-2" /> Cancel download
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}

            {/* ── Recently Downloaded ── */}
            {done.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setRecentOpen(o => !o)}
                  className="flex items-center gap-2 w-full py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex-1 text-left">Recently Downloaded</span>
                  {recentOpen
                    ? <ChevronUp className="h-4 w-4" />
                    : <ChevronDown className="h-4 w-4" />
                  }
                </button>

                {recentOpen && (
                  <div className="space-y-2 mt-1">
                    {done.map(item => (
                      <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-card border border-border/50 p-3 opacity-70">
                        <img
                          src={proxyImage(item.mangaThumbnail, item.sourceId)}
                          alt={item.mangaTitle}
                          className="h-16 w-12 rounded-xl object-cover shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{item.mangaTitle}</div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            Chapter {item.chapterNumber}{item.chapterTitle ? `: ${item.chapterTitle}` : ""}
                          </div>
                          <ProgressBar value={100} />
                        </div>
                        <div className="shrink-0">
                          <span className="text-xs font-semibold text-green-500">Done</span>
                        </div>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground text-xs"
                      onClick={() => queueActions.clearDone()}
                    >
                      Clear completed
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
