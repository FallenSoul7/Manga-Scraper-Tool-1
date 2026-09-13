import { useMemo, useState } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, Download, FileImage, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proxyImage } from "@/lib/utils";
import { saveChapterToFile } from "@/lib/save-to-file";

type Page = { index: number; url: string };
type PagesResponse = { pages: Page[] };

function isVideo(url: string) {
  return /\.(mp4|webm|mov|mkv|avi|m4v)(\?|$)/i.test(url);
}

function decodeRoutePart(value: string | undefined): string {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

function mediaUrl(url: string): string {
  // Images still use the SSRF-safe proxy because Pawchive's CDN can hotlink-
  // protect image requests and the proxy supplies the source referer.
  return proxyImage(url, "all.pawchive");
}

function videoUrl(url: string): string {
  // Keep video bytes off Render: the browser downloads and decodes the media
  // on the user's device instead of making the backend buffer a long file.
  return url;
}

export default function PawchivePostPage() {
  const [, params] = useRoute("/sources/all.pawchive/post/:postId");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const postId = decodeRoutePart(params?.postId);
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const creatorId = searchParams.get("creatorId") ?? "";
  const postTitle = searchParams.get("postTitle") ?? "Pawchive post";
  const creatorTitle = searchParams.get("creatorTitle") ?? "Pawchive";
  const favoriteKey = `comihub:pawchive-favorite:${postId}`;
  const [isFavorite, setIsFavorite] = useState(() => {
    try { return localStorage.getItem(favoriteKey) === "1"; } catch { return false; }
  });
  const [videoFallbacks, setVideoFallbacks] = useState<Set<string>>(() => new Set());
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState("");

  function toggleFavorite() {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      if (next) localStorage.setItem(favoriteKey, "1");
      else localStorage.removeItem(favoriteKey);
    } catch { /* local storage may be unavailable in private browsing */ }
  }

  function videoSource(url: string): string {
    return videoFallbacks.has(url) ? mediaUrl(url) : videoUrl(url);
  }

  function useVideoFallback(url: string) {
    setVideoFallbacks(current => {
      if (current.has(url)) return current;
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }

  const pages = useQuery<PagesResponse>({
    queryKey: ["pawchive-post", postId],
    queryFn: () => customFetch<PagesResponse>(
      `/api/chapter/${encodeURIComponent(postId)}/pages`,
      { headers: { "X-Source": "all.pawchive" } },
    ),
    enabled: !!postId,
  });

  const media = useMemo(() => pages.data?.pages ?? [], [pages.data]);
  const allVideo = media.length > 0 && media.every(page => isVideo(page.url));

  async function download() {
    setDownloadError("");
    setDownloadProgress(0);
    try {
      await saveChapterToFile({
        chapterId: postId,
        sourceId: "all.pawchive",
        mangaTitle: "Pawchive post",
        chapterLabel: postId,
        onProgress: setDownloadProgress,
      });
      setDownloadProgress(100);
    } catch (error) {
      setDownloadProgress(null);
      setDownloadError(error instanceof Error ? error.message : "Download failed");
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-white/10 bg-black/90 px-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => setLocation(creatorId ? `/sources/all.pawchive/creator/${creatorId}` : "/sources/all.pawchive")} className="text-white hover:bg-white/10" aria-label="Close post">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{postTitle}</h1>
          <p className="truncate text-xs text-white/50">{creatorTitle} · {media.length} attachment{media.length === 1 ? "" : "s"}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleFavorite} className="text-white hover:bg-white/10" aria-label={isFavorite ? "Remove favorite" : "Favorite post"} aria-pressed={isFavorite}>
          <Heart className={`h-5 w-5 ${isFavorite ? "fill-red-500 text-red-500" : ""}`} />
        </Button>
        <Button variant="ghost" size="icon" onClick={download} disabled={downloadProgress !== null} className="text-white hover:bg-white/10" aria-label="Download post">
          {downloadProgress !== null ? <span className="text-[10px] font-bold">{Math.round(downloadProgress)}%</span> : <Download className="h-5 w-5" />}
        </Button>
      </header>

      {pages.isLoading ? (
        <div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-9 w-9 animate-spin text-white/50" /></div>
      ) : pages.isError ? (
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center text-white/60">
          <FileImage className="h-10 w-10" />
          <p>Unable to load this Pawchive post.</p>
          <Button variant="outline" onClick={() => setLocation(creatorId ? `/sources/all.pawchive/creator/${creatorId}` : "/sources/all.pawchive")}>Go back</Button>
        </div>
      ) : media.length === 0 ? (
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-white/60">
          <FileImage className="h-10 w-10" />
          <p>This post has no supported media attachments.</p>
        </div>
      ) : allVideo ? (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-black p-3">
           <video
             src={videoSource(media[0].url)}
             onError={() => useVideoFallback(media[0].url)}
             controls playsInline preload="metadata" autoPlay
             className="max-h-[calc(100vh-5rem)] w-full max-w-5xl rounded-xl"
           />
        </div>
      ) : media.length === 1 && !isVideo(media[0].url) ? (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-black p-3">
           <img src={mediaUrl(media[0].url)} alt="Pawchive artwork" className="max-h-[calc(100vh-5rem)] max-w-full rounded-xl object-contain" />
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 p-3 sm:grid-cols-2">
           {media.map(page => isVideo(page.url) ? (
             <video
               key={page.index}
               src={videoSource(page.url)}
               onError={() => useVideoFallback(page.url)}
               controls playsInline preload="metadata"
               className="w-full rounded-xl bg-black"
             />
          ) : (
             <img key={page.index} src={mediaUrl(page.url)} alt={`Attachment ${page.index + 1}`} loading="lazy" className="w-full rounded-xl object-contain" />
          ))}
        </div>
      )}
      {downloadError && <p className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-900/90 px-3 py-2 text-xs">{downloadError}</p>}
    </main>
  );
}
