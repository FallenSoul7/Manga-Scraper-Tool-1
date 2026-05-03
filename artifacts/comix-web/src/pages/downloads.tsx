import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock3, Download, Trash2 } from "lucide-react";
import { proxyImage } from "@/lib/utils";

export default function DownloadsPage() {
  const [, setLocation] = useLocation();
  const library = useStore(s => s.library);
  const progress = useStore(s => s.progress);

  const items = useMemo(() => {
    return Object.values(library)
      .filter(manga => manga.downloadedAt || manga.pendingUpdates.length > 0)
      .map(manga => {
        const chapters = Object.values(progress).filter(p => p.mangaId === manga.id);
        const latest = chapters.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
        return { manga, latest, count: chapters.length };
      })
      .sort((a, b) => (b.manga.downloadedAt ?? 0) - (a.manga.downloadedAt ?? 0));
  }, [library, progress]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-4">
        <div className="flex items-center gap-3 py-2">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/system")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-semibold">Downloaded</h1>
        </div>

        <div className="space-y-3 pt-4">
          {items.length === 0 ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="text-5xl">Σ(ಠ_ಠ)</div>
              <div>No Downloads</div>
            </div>
          ) : (
            items.map(({ manga, latest, count }) => (
              <div key={manga.id} className="flex items-start gap-4 rounded-2xl p-2">
                <img src={proxyImage(manga.thumbnail, manga.sourceId)} alt={manga.title} className="h-32 w-24 rounded-2xl object-cover shrink-0" />
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xl font-medium leading-tight line-clamp-2">{manga.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
                        <Clock3 className="h-4 w-4" />
                        {latest ? `Chapter ${latest.chapterNumber}` : "Ongoing"}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => storeActions.removeFromLibrary(manga.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setLocation(`/manga/${manga.id}`)}>
                      Open
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setLocation(`/reader/${latest?.chapterId ?? 0}?mangaId=${manga.id}`)} disabled={!latest}>
                      <Download className="mr-2 h-4 w-4" />
                      Downloaded {count}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}