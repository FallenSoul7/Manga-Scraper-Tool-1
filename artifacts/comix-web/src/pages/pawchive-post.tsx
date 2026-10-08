import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, ArrowUp, Check, Download, FileImage, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mediaImage, mediaVideo } from "@/lib/utils";
import { saveChapterToFile } from "@/lib/save-to-file";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStore, storeActions } from "@/lib/storage";

type Page = { index: number; url: string };
type PagesResponse = { pages: Page[] };

function isVideo(url: string) {
  return /\.(mp4|webm|mov|mkv|avi|m4v)(?:[?#&]|$)/i.test(url);
}

function videoType(url: string): string | undefined {
  if (/\.mp4(?:[?#&]|$)/i.test(url)) return "video/mp4";
  if (/\.webm(?:[?#&]|$)/i.test(url)) return "video/webm";
  if (/\.mov(?:[?#&]|$)/i.test(url)) return "video/quicktime";
  return undefined;
}

function decodeRoutePart(value: string | undefined): string {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

function mediaUrl(url: string): string {
  // Images still use the SSRF-safe proxy because Pawchive's CDN can hotlink-
  // protect image requests and the proxy supplies the source referer.
  return mediaImage(url, "all.pawchive");
}

function videoUrl(url: string): string {
  // Keep video bytes off Render: the browser downloads and decodes the media
  // on the user's device instead of making the backend buffer a long file.
  return mediaVideo(url, "all.pawchive");
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
  const postThumbnail = searchParams.get("postThumbnail") ?? "";
  const postThumbnailIsStatic = searchParams.get("postThumbnailIsStatic") === "1";
  const fromLibrary = searchParams.get("from") === "library";
  const libraryCategoryId = searchParams.get("cat") ?? "default";
  const categories = useStore(state => state.categories);
  const savedPost = useStore(state => state.library[postId]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["default"]);
  const [videoFallbacks, setVideoFallbacks] = useState<Set<string>>(() => new Set());
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [showScrollUp, setShowScrollUp] = useState(false);
  const lastScrollY = useRef(0);
  const scrollButtonTimer = useRef<number | null>(null);

  function goBack() {
    if (fromLibrary) {
      const params = new URLSearchParams({ cat: libraryCategoryId, from: "library" });
      setLocation(`/?${params.toString()}`);
      return;
    }
    setLocation(creatorId ? `/sources/all.pawchive/creator/${encodeURIComponent(creatorId)}` : "/sources/all.pawchive");
  }

  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      const currentY = window.scrollY;
      const movingUp = currentY < lastScrollY.current - 2;
      lastScrollY.current = currentY;
      if (scrollButtonTimer.current !== null) window.clearTimeout(scrollButtonTimer.current);
      if (movingUp && currentY > 280) {
        setShowScrollUp(true);
        scrollButtonTimer.current = window.setTimeout(() => setShowScrollUp(false), 220);
      } else {
        setShowScrollUp(false);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollButtonTimer.current !== null) window.clearTimeout(scrollButtonTimer.current);
    };
  }, []);

  function toggleFavorite() {
    if (savedPost) {
      storeActions.removeFromLibrary(postId);
      return;
    }
    setSelectedCategories(["default"]);
    setCategoryDialogOpen(true);
  }

  function saveFavorite() {
    const hasVideo = media.some(page => isVideo(page.url));
    const hasImage = media.some(page => !isVideo(page.url));
    const staticPageThumbnail = media.find(page =>
      !isVideo(page.url) && /\.(jpe?g|png)(?:[?#&]|$)/i.test(page.url),
    )?.url;
    const staticThumbnail = postThumbnailIsStatic && postThumbnail
      ? postThumbnail
      : staticPageThumbnail ?? "/public/source-icons/all.pawchive.svg";
    storeActions.addToLibrary({
      id: postId,
      title: postTitle,
      thumbnail: hasVideo ? staticThumbnail : media.find(page => !isVideo(page.url))?.url ?? "/public/source-icons/all.pawchive.svg",
      type: media.some(page => isVideo(page.url)) ? "Pawchive video post" : "Pawchive post",
      sourceId: "all.pawchive",
      mediaType: hasVideo ? (hasImage ? "mixed" : "video") : "image",
      thumbnailIsStatic: hasVideo,
      creatorId: creatorId || undefined,
      creatorTitle: creatorTitle || undefined,
      addedAt: Date.now(),
      categoryIds: selectedCategories.length ? selectedCategories : ["default"],
      lastChapterCountSeen: 1,
      pendingUpdates: [],
      updatesEnabled: false,
      updatesInitialized: false,
      trackedChapterIds: [],
    });
    setCategoryDialogOpen(false);
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

  useEffect(() => {
    if (!savedPost || !pages.data) return;
    const hasVideo = media.some(page => isVideo(page.url));
    const hasImage = media.some(page => !isVideo(page.url));
    const mediaType = hasVideo ? (hasImage ? "mixed" : "video") : "image";
    const staticPageThumbnail = media.find(page =>
      !isVideo(page.url) && /\.(jpe?g|png)(?:[?#&]|$)/i.test(page.url),
    )?.url;
    const thumbnail = hasVideo && !savedPost.thumbnailIsStatic
      ? (postThumbnailIsStatic && postThumbnail ? postThumbnail : staticPageThumbnail ?? "/public/source-icons/all.pawchive.svg")
      : savedPost.thumbnail;
    const thumbnailIsStatic = hasVideo || savedPost.thumbnailIsStatic;
    const type = hasVideo ? "Pawchive video post" : (savedPost.type ?? "Pawchive post");
    const nextCreatorId = savedPost.creatorId ?? (creatorId || undefined);
    const nextCreatorTitle = savedPost.creatorTitle ?? ((savedPost.creatorId || creatorId) ? creatorTitle : undefined);

    if (
      savedPost.mediaType !== mediaType || savedPost.type !== type ||
      savedPost.thumbnail !== thumbnail || savedPost.creatorId !== nextCreatorId ||
      savedPost.creatorTitle !== nextCreatorTitle || savedPost.thumbnailIsStatic !== thumbnailIsStatic
    ) {
      storeActions.addToLibrary({
        ...savedPost,
        mediaType,
        type,
        thumbnail,
        thumbnailIsStatic,
        creatorId: nextCreatorId,
        creatorTitle: nextCreatorTitle,
      });
    }
  }, [savedPost, pages.data, media, creatorId, creatorTitle]);

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
        <Button variant="ghost" size="icon" onClick={goBack} className="text-white hover:bg-white/10" aria-label="Close post">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{postTitle}</h1>
          <p className="truncate text-xs text-white/50">{creatorTitle} · {media.length} attachment{media.length === 1 ? "" : "s"}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleFavorite} className="text-white hover:bg-white/10" aria-label={savedPost ? "Remove from library" : "Save post"} aria-pressed={!!savedPost}>
          <Heart className={`h-5 w-5 ${savedPost ? "fill-red-500 text-red-500" : ""}`} />
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
          <Button variant="outline" onClick={goBack}>Go back</Button>
        </div>
      ) : media.length === 0 ? (
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-white/60">
          <FileImage className="h-10 w-10" />
          <p>This post has no supported media attachments.</p>
        </div>
      ) : allVideo ? (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-black p-3">
           <video
             key={videoSource(media[0].url)}
             onError={() => useVideoFallback(media[0].url)}
             controls playsInline preload="auto" autoPlay muted
             className="max-h-[calc(100vh-5rem)] w-full max-w-5xl rounded-xl"
           >
             <source src={videoSource(media[0].url)} type={videoType(media[0].url)} />
           </video>
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
               onError={() => useVideoFallback(page.url)}
               controls playsInline preload="auto" muted
               className="w-full rounded-xl bg-black"
             >
               <source src={videoSource(page.url)} type={videoType(page.url)} />
             </video>
          ) : (
             <img key={page.index} src={mediaUrl(page.url)} alt={`Attachment ${page.index + 1}`} loading="lazy" className="w-full rounded-xl object-contain" />
          ))}
        </div>
      )}
      {showScrollUp && (
        <button type="button" onClick={() => { setShowScrollUp(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label="Back to top while scrolling up" title="Back to top" className="fixed bottom-6 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/80 text-white shadow-lg backdrop-blur transition-opacity">
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Save Pawchive post</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Choose the categories for this saved post.</p>
          <div className="max-h-64 space-y-1 overflow-y-auto py-2">
            {categories.map(category => {
              const checked = selectedCategories.includes(category.id);
              return (
                <button key={category.id} type="button" onClick={() => setSelectedCategories(current => checked ? current.filter(id => id !== category.id) : [...current, category.id])} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                  <span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                  <span>{category.name}</span>
                </button>
              );
            })}
          </div>
          <Button onClick={saveFavorite}>Save to library</Button>
        </DialogContent>
      </Dialog>
      {downloadError && <p className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-900/90 px-3 py-2 text-xs">{downloadError}</p>}
    </main>
  );
}
