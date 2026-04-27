import { useRoute, Link } from "wouter";
import { useGetMangaDetails, useGetChapters } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";
import { proxyImage } from "@/lib/utils";
import { Loader2, ArrowLeft, Star, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { format } from "date-fns";

export default function MangaDetail() {
  const [, params] = useRoute("/manga/:id");
  const id = params?.id;
  const { settings } = useSettings();
  const [showFullSynopsis, setShowFullSynopsis] = useState(false);

  const { data: manga, isLoading: mangaLoading } = useGetMangaDetails(id || "", {
    poster: settings.posterQuality,
    alt: settings.showAltNames,
    score: settings.scorePosition,
  }, {
    query: { enabled: !!id }
  });

  const { data: chapters, isLoading: chaptersLoading } = useGetChapters(id || "", {
    dedupe: settings.dedupeChapters,
  }, {
    query: { enabled: !!id }
  });

  if (mangaLoading) {
    return <div className="flex justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!manga) {
    return <div className="py-32 text-center text-muted-foreground">Manga not found.</div>;
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl animate-in fade-in duration-500">
      <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-primary mb-8 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Library
      </Link>

      <div className="flex flex-col md:flex-row gap-8 md:gap-12">
        <div className="shrink-0 mx-auto md:mx-0 w-64 md:w-80">
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-lg">
            <img
              src={proxyImage(manga.thumbnail)}
              alt={manga.title}
              className="h-full w-full object-cover"
            />
            {manga.isNsfw && (
              <div className="absolute top-3 right-3 rounded-md bg-destructive px-2 py-1 text-xs font-bold text-destructive-foreground">
                18+
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-6">
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">{manga.status}</Badge>
              {manga.type && <Badge variant="outline">{manga.type}</Badge>}
              {manga.rating && (
                <div className="flex items-center gap-1 text-sm font-medium text-amber-500">
                  <Star className="h-4 w-4 fill-current" />
                  {manga.rating}
                </div>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif font-bold text-foreground mb-2 leading-tight">
              {manga.title}
            </h1>
            <div className="text-lg text-muted-foreground font-medium">
              {[manga.author, manga.artist].filter(Boolean).join(" • ")}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {manga.genres?.map(genre => (
              <Badge key={genre} variant="secondary" className="font-normal">{genre}</Badge>
            ))}
          </div>

          {manga.synopsis && (
            <div className="prose prose-stone dark:prose-invert max-w-none">
              <div className={showFullSynopsis ? "" : "line-clamp-4 relative"}>
                <p className="text-muted-foreground leading-relaxed">{manga.synopsis}</p>
                {!showFullSynopsis && (
                  <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-background to-transparent" />
                )}
              </div>
              <button 
                onClick={() => setShowFullSynopsis(!showFullSynopsis)}
                className="mt-2 text-sm font-medium text-primary hover:underline flex items-center gap-1"
              >
                {showFullSynopsis ? (
                  <>Show Less <ChevronUp className="h-4 w-4" /></>
                ) : (
                  <>Read More <ChevronDown className="h-4 w-4" /></>
                )}
              </button>
            </div>
          )}

          {settings.showAltNames && manga.altTitles && manga.altTitles.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Alternative Titles</h3>
              <p className="text-sm text-muted-foreground">{manga.altTitles.join(", ")}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-16">
        <h2 className="text-2xl font-serif font-bold text-foreground mb-6 flex items-center gap-3">
          Chapters 
          <span className="text-base font-normal text-muted-foreground bg-muted px-3 py-1 rounded-full">
            {chapters?.items.length || 0}
          </span>
        </h2>
        
        {chaptersLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {chapters?.items.map((chapter) => (
              <Link key={chapter.id} href={`/reader/${chapter.id}`}>
                <div className="group p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer flex flex-col gap-1">
                  <div className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-start justify-between gap-2">
                    <span className="line-clamp-1">Chapter {chapter.number}: {chapter.title}</span>
                    {chapter.isOfficial && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-amber-500/20 text-amber-600">Official</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span className="truncate max-w-[60%]">{chapter.scanlator || "Unknown"}</span>
                    <span>{format(new Date(chapter.date * 1000), 'MMM d, yyyy')}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
