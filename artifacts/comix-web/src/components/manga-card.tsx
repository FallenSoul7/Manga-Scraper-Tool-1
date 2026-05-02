import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import type { MangaSummary } from "@workspace/api-client-react";

export function MangaCard({ manga, sourceId }: { manga: MangaSummary; sourceId?: string }) {
  return (
    <Link href={`/manga/${manga.id}`}>
      <div className="group relative flex flex-col gap-2 cursor-pointer">
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-sm transition-all duration-300 hover-elevate group-hover:shadow-md">
          <img
            src={proxyImage(manga.thumbnail, sourceId)}
            alt={manga.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          {manga.isNsfw && (
            <div className="absolute top-2 right-2 rounded-md bg-destructive/90 px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground backdrop-blur-sm">
              18+
            </div>
          )}
        </div>
        <h3 className="font-semibold text-xs sm:text-sm text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors px-0.5">
          {manga.title}
        </h3>
      </div>
    </Link>
  );
}
