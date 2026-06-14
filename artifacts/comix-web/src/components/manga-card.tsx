import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import { Check } from "lucide-react";
import type { MangaSummary } from "@workspace/api-client-react";

interface MangaCardProps {
  manga: MangaSummary;
  sourceId?: string;
  href?: string;
  isSelecting?: boolean;
  isSelected?: boolean;
  onNavigate?: () => void;
  showSourceBadge?: boolean;
}

/** Turn "en.comickfan" → "ComicKFan", "all.mangadex" → "MangaDex", etc. */
function sourceLabel(sourceId: string): string {
  const known: Record<string, string> = {
    "en.comix": "Comix",
    "all.mangadex": "MangaDex",
    "en.comickfan": "ComicKFan",
    "en.mangafreak": "MangaFreak",
    "en.resetscans": "ResetScans",
    "en.manhuaplus": "ManhuaPlus",
    "en.utoon": "Utoon",
    "en.elftoon": "ElfToon",
    "all.thunderscans": "ThunderScans",
    "all.comicklive": "Comick",
    "all.danbooru": "Danbooru",
    "all.hentaifox": "HentaiFox",
    "en.ninehentai": "9Hentai",
  };
  if (known[sourceId]) return known[sourceId];
  const slug = sourceId.split(".").pop() ?? sourceId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function MangaCard({ manga, sourceId, href, isSelecting, isSelected, onNavigate, showSourceBadge }: MangaCardProps) {
  const inner = (
    <div className="group relative flex flex-col gap-2 cursor-pointer select-none">
      <div
        className={[
          "relative aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-sm transition-all duration-300",
          !isSelecting && "hover-elevate group-hover:shadow-md",
          isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
        ].filter(Boolean).join(" ")}
      >
        <img
          src={proxyImage(manga.thumbnail, sourceId)}
          alt={manga.title}
          className={[
            "h-full w-full object-cover transition-all duration-300",
            !isSelecting && "group-hover:scale-105",
            isSelected && "opacity-70",
          ].filter(Boolean).join(" ")}
          loading="lazy"
          draggable={false}
        />
        {manga.isNsfw && (
          <div className="absolute top-2 right-2 rounded-md bg-destructive/90 px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground backdrop-blur-sm">
            18+
          </div>
        )}
        {showSourceBadge && sourceId && sourceId !== "en.comix" && (
          <div className="absolute bottom-1.5 left-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold text-white/90 backdrop-blur-sm leading-tight max-w-[85%] truncate">
            {sourceLabel(sourceId)}
          </div>
        )}
        {isSelecting && (
          <div
            className={[
              "absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all shadow-sm",
              isSelected
                ? "bg-primary border-primary"
                : "bg-background/90 border-muted-foreground/50",
            ].join(" ")}
          >
            {isSelected && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
          </div>
        )}
      </div>
      <h3
        className={[
          "font-semibold text-xs sm:text-sm text-foreground line-clamp-2 leading-snug transition-colors px-0.5",
          !isSelecting && "group-hover:text-primary",
        ].filter(Boolean).join(" ")}
      >
        {manga.title}
      </h3>
    </div>
  );

  if (isSelecting) return inner;

  return <Link href={href ?? `/manga/${manga.id}`} onClick={onNavigate}>{inner}</Link>;
}
