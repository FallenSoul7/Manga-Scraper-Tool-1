import { memo, useState } from "react";
import { Link } from "wouter";
import { proxyImage } from "@/lib/utils";
import { Check } from "lucide-react";
import { BookOpen, Film } from "lucide-react";
import type { MangaSummary } from "@workspace/api-client-react";
import { useSettings } from "@/hooks/use-settings";

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
    "en.onlythebesthentai": "OnlyTheBestHentai",
    "en.pandachaika": "PandaChaika",
    "video.hentaiyoga": "HentaiYoga",
  };
  if (known[sourceId]) return known[sourceId];
  const slug = sourceId.split(".").pop() ?? sourceId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export const MangaCard = memo(function MangaCard({
  manga,
  sourceId,
  href,
  isSelecting,
  isSelected,
  onNavigate,
  showSourceBadge,
}: MangaCardProps) {
  const { settings } = useSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const thumbnail = manga.thumbnail ? proxyImage(manga.thumbnail, sourceId) : "";
  const inner = (
    <div className="group relative cursor-pointer select-none">
      <div
        className={[
          "relative aspect-[3/4] overflow-hidden rounded-xl bg-muted shadow-sm transition-all duration-300",
          !isSelecting && "hover-elevate group-hover:shadow-md",
          isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
        ].filter(Boolean).join(" ")}
      >
        {thumbnail && !imageFailed ? (
          <img
            src={thumbnail}
            alt={manga.title}
            className={[
              "h-full w-full object-cover object-center bg-black/10 transition-all duration-300",
              isSelected && "opacity-70",
            ].filter(Boolean).join(" ")}
            loading="lazy"
            draggable={false}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div
            className="h-full w-full flex flex-col items-center justify-center gap-2 bg-muted px-2 text-center text-muted-foreground"
            aria-label={`${manga.title} cover unavailable`}
          >
            <BookOpen className="h-8 w-8 opacity-40" />
            <span className="text-[10px] font-medium leading-tight line-clamp-3">{manga.title}</span>
          </div>
        )}
        {manga.isNsfw && settings.showNsfwBadge && (
          <div className="absolute top-2 right-2 rounded-md bg-destructive/90 px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground backdrop-blur-sm">
            18+
          </div>
        )}
        {manga.mediaType === "anime" && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-1 text-white backdrop-blur-sm" title="Video">
            <Film className="h-3.5 w-3.5" />
          </div>
        )}
        {showSourceBadge && sourceId && (
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
          "mt-2 px-0.5 text-xs font-semibold leading-snug text-foreground line-clamp-2 sm:text-sm",
          !isSelecting && "transition-colors group-hover:text-primary",
        ].filter(Boolean).join(" ")}
      >
        {manga.title}
      </h3>
    </div>
  );

  if (isSelecting) return inner;

  return <Link href={href ?? `/manga/${manga.id}`} onClick={onNavigate}>{inner}</Link>;
});
