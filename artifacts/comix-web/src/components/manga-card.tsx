import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import type { MangaSummary } from "@workspace/api-client-react";

export function MangaCard({ manga }: { manga: MangaSummary }) {
  return (
    <Link href={`/manga/${manga.id}`}>
      <div className="group relative flex flex-col gap-3 cursor-pointer">
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-sm transition-all duration-300 hover-elevate group-hover:shadow-md">
          <img
            src={proxyImage(manga.thumbnail)}
            alt={manga.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          {manga.isNsfw && (
            <div className="absolute top-2 right-2 rounded-md bg-destructive/90 px-2 py-1 text-xs font-semibold text-destructive-foreground backdrop-blur-sm">
              18+
            </div>
          )}
          {manga.type && (
            <div className="absolute bottom-2 left-2 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-foreground backdrop-blur-sm">
              {manga.type}
            </div>
          )}
        </div>
        <div>
          <h3 className="font-serif font-semibold text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">
            {manga.title}
          </h3>
        </div>
      </div>
    </Link>
  );
}
