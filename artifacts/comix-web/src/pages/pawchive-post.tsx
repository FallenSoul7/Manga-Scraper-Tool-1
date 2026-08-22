import { useEffect, useMemo, useState } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, setExtraHeader } from "@workspace/api-client-react";
import { ArrowLeft, Download, FileImage, Loader2, Play, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proxyImage } from "@/lib/utils";
import { saveChapterToFile } from "@/lib/save-to-file";

type Page = { index: number; url: string };
type PagesResponse = { pages: Page[] };

function isVideo(url: string) {
  return /\.(mp4|webm|mov|mkv|avi|m4v)(\?|$)/i.test(url);
}

export default function PawchivePostPage() {
  const [, params] = useRoute("/sources/all.pawchive/post/:postId");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const postId = params?.postId ? decodeURIComponent(params.postId) : "";
  const creatorId = new URLSearchParams(search).get("creatorId") ?? "";
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => { setExtraHeader("X-Source", "all.pawchive"); }, []);

  const pages = useQuery<PagesResponse>({
    queryKey: ["pawchive-post", postId],
    queryFn: () => customFetch<PagesResponse>(`/api/chapter/${postId}/pages`),
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
          <h1 className="truncate font-semibold">Pawchive post</h1>
          <p className="text-xs text-white/50">{media.length} attachment{media.length === 1 ? "" : "s"}</p>
        </div>
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
          <video src={media[0].url} controls playsInline autoPlay className="max-h-[calc(100vh-5rem)] w-full max-w-5xl rounded-xl" />
        </div>
      ) : media.length === 1 && !isVideo(media[0].url) ? (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-black p-3">
          <img src={proxyImage(media[0].url, "all.pawchive")} alt="Pawchive artwork" className="max-h-[calc(100vh-5rem)] max-w-full rounded-xl object-contain" />
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 p-3 sm:grid-cols-2">
          {media.map(page => isVideo(page.url) ? (
            <video key={page.index} src={page.url} controls playsInline className="w-full rounded-xl bg-black" />
          ) : (
            <img key={page.index} src={proxyImage(page.url, "all.pawchive")} alt={`Attachment ${page.index + 1}`} loading="lazy" className="w-full rounded-xl object-contain" />
          ))}
        </div>
      )}
      {downloadError && <p className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-900/90 px-3 py-2 text-xs">{downloadError}</p>}
    </main>
  );
}