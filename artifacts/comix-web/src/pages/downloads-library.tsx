import { useMemo } from "react";
import { useLocation } from "wouter";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock3, Trash2 } from "lucide-react";
import { proxyImage } from "@/lib/utils";

export default function DownloadsLibraryPage() {
  const [, setLocation] = useLocation();
  const library  = useStore(s => s.library);
  const progress = useStore(s => s.progress);

  const items = useMemo(() => {
    return Object.values(library)
      .filter(manga => !!manga.downloadedAt)
      .map(manga => {
        const chapters = Object.values(progress).filter(p => p.mangaId === manga.id);
        const latest   = chapters.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
        const author   = manga.author ?? null;
        return { manga, latest, author };
      })
      .sort((a, b) => (b.manga.downloadedAt ?? 0) - (a.manga.downloadedAt ?? 0));
  }, [library, progress]);

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

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground px-6">
          <div className="text-4xl">(◕‿◕)</div>
          <div className="text-sm text-center">
            No downloaded manga yet.<br />Download chapters from any manga page.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {items.map(({ manga, latest, author }) => (
            <div
              key={manga.id}
              role="button"
              tabIndex={0}
              onClick={() => setLocation(`/manga/${manga.id}`)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setLocation(`/manga/${manga.id}`); }}
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/40 active:bg-muted/60 transition-colors"
            >
              {/* Cover */}
              <img
                src={proxyImage(manga.thumbnail, manga.sourceId)}
                alt={manga.title}
                className="h-20 w-14 rounded-xl object-cover shrink-0 shadow-sm"
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base leading-snug line-clamp-2 mb-0.5">
                  {manga.title}
                </div>
                {author && (
                  <div className="text-xs text-muted-foreground truncate mb-1">{author}</div>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 className="h-3 w-3 shrink-0" />
                  <span>{manga.status ? manga.status.charAt(0).toUpperCase() + manga.status.slice(1) : "Ongoing"}</span>
                </div>
              </div>

              {/* Delete */}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  storeActions.removeFromLibrary(manga.id);
                }}
                className="h-9 w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                title="Remove from library"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
