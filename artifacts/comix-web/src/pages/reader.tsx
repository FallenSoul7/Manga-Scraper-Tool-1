import { useRoute, Link, useSearch, useLocation } from "wouter";
import {
  useGetChapterPages,
  useGetChapters,
  useGetMangaDetails,
  getGetChapterPagesQueryKey,
  getGetChaptersQueryKey,
  getGetMangaDetailsQueryKey,
  setExtraHeader,
} from "@workspace/api-client-react";
import { proxyImage } from "@/lib/utils";
// ── Keep this import ─────────────────────────────────────────────────────
import { getProxiedImageUrl } from "@/lib/vpn";
import { Loader2, X, Settings, ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
import { useStore, storeActions, ReaderSettings } from "@/lib/storage";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export default function Reader() {
  const [, params] = useRoute("/reader/:chapterId");
  const chapterId = params?.chapterId || "";
  const searchString = useSearch();
  const mangaId = new URLSearchParams(searchString).get("mangaId");
  const sourceId = new URLSearchParams(searchString).get("sourceId");
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (sourceId) setExtraHeader("X-Source", sourceId);
  }, [sourceId]);

  const readerSettings = useStore(s => s.reader);
  const progressMap = useStore(s => s.progress);
  const scanlatorPrefs = useStore(s => s.scanlatorPrefs);
  const progressKey = `${mangaId}:${chapterId}`;
  const currentProgress = progressMap[progressKey];
  const selectedScanlator = mangaId ? (scanlatorPrefs[mangaId] ?? null) : null;

  const [showControls, setShowControls] = useState(true);
  const [currentPage, setCurrentPage] = useState(currentProgress?.lastPageRead || 0);
  const [loadedImgs, setLoadedImgs] = useState<Record<number, boolean>>({});

  type AppendedChapter = { id: string; number: number; title: string; pages: { index: number; url: string }[] };
  const [appendedChapters, setAppendedChapters] = useState<AppendedChapter[]>([]);
  const [loadingNextChapter, setLoadingNextChapter] = useState(false);
  const appendedIdsRef = useRef<Set<string>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const { data: pagesData, isLoading: pagesLoading } = useGetChapterPages(chapterId, {
    query: {
      enabled: !!chapterId && chapterId !== "0",
      queryKey: getGetChapterPagesQueryKey(chapterId),
    },
  });

  const chapterFetchParams = { dedupe: false };
  const { data: chaptersData } = useGetChapters(mangaId || "", chapterFetchParams, {
    query: {
      enabled: !!mangaId,
      queryKey: getGetChaptersQueryKey(mangaId || "", chapterFetchParams),
    },
  });

  const { data: mangaData } = useGetMangaDetails(mangaId || "", undefined, {
    query: {
      enabled: !!mangaId,
      queryKey: getGetMangaDetailsQueryKey(mangaId || ""),
    },
  });

  useEffect(() => {
    const TICK_MS = 5000;
    let lastTick = document.visibilityState === 'visible' ? Date.now() : null;
    const flush = () => {
      if (lastTick === null) return;
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;
      if (delta > 0) storeActions.addReadingTime(Math.min(delta, 60_000));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { lastTick = Date.now(); }
      else { flush(); lastTick = null; }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(flush, TICK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
      flush();
    };
  }, []);

  useEffect(() => {
    if (!(readerSettings.keepScreenOn && 'wakeLock' in navigator)) return;
    const requestWakeLock = async () => {
      try { wakeLockRef.current = await navigator.wakeLock.request('screen'); }
      catch (err) { console.error(err); }
    };
    requestWakeLock();
    const handleVisibilityChange = () => {
      if (wakeLockRef.current !== null && document.visibilityState === 'visible') requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [readerSettings.keepScreenOn]);

  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!pagesData?.pages.length || didInitialScroll.current) return;
    const target = currentProgress?.lastPageRead;
    if (!target || target === 0) { didInitialScroll.current = true; return; }
    if (readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl') {
      if (containerRef.current) {
        containerRef.current.scrollTo({
          left: (readerSettings.direction === 'ltr' ? target : -target) * containerRef.current.clientWidth,
        });
      }
      didInitialScroll.current = true;
      return;
    }
    requestAnimationFrame(() => {
      const pageEl = document.getElementById(`page-${target}`);
      if (pageEl) pageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      didInitialScroll.current = true;
    });
  }, [pagesData, currentProgress?.lastPageRead, readerSettings.direction]);

  useEffect(() => {
    const handleScroll = () => {
      if (!pagesData?.pages.length || !mangaId || !chaptersData || !mangaData) return;
      clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => {
        const container = readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical' ? window : containerRef.current;
        if (!container) return;
        let newPage = currentPage;
        if (readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical') {
          const scrollY = window.scrollY;
          const wh = window.innerHeight;
          const pageElements = Array.from(document.querySelectorAll('.reader-page'));
          for (let i = 0; i < pageElements.length; i++) {
            const rect = pageElements[i].getBoundingClientRect();
            if (rect.top <= wh / 2 && rect.bottom >= wh / 2) { newPage = i; break; }
          }
          const docHeight = document.documentElement.scrollHeight;
          if (scrollY + wh >= docHeight * 0.9) {
            const ch = chaptersData.items.find(c => String(c.id) === chapterId);
            if (ch) storeActions.markChapterRead(mangaId, ch, mangaData, pagesData.pages.length);
          }
        } else {
          if (containerRef.current) {
            const scrollX = Math.abs(containerRef.current.scrollLeft);
            const cw = containerRef.current.clientWidth;
            newPage = Math.round(scrollX / cw);
            if (newPage >= pagesData.pages.length - 1) {
              const ch = chaptersData.items.find(c => String(c.id) === chapterId);
              if (ch) storeActions.markChapterRead(mangaId, ch, mangaData, pagesData.pages.length);
            }
          }
        }
        if (newPage !== currentPage) {
          setCurrentPage(newPage);
          const ch = chaptersData.items.find(c => String(c.id) === chapterId);
          if (ch && !currentProgress?.isRead) {
            storeActions.recordProgress({
              mangaId, chapterId: ch.id, chapterNumber: ch.number,
              chapterTitle: ch.title, mangaTitle: mangaData.title,
              mangaThumbnail: mangaData.thumbnail, totalPages: pagesData.pages.length,
              lastPageRead: newPage, isRead: false,
            });
          }
        }
      }, 500);
    };
    const container = readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical' ? window : containerRef.current;
    if (container) container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout.current);
    };
  }, [readerSettings.direction, pagesData, mangaId, chaptersData, mangaData, currentPage, currentProgress?.isRead]);

  const navChapters = useMemo<any[]>(() => {
    if (!chaptersData?.items) return [];
    if (!selectedScanlator) {
      const map = new Map<number, any>();
      const score = (ch: any) => (ch.isOfficial ? 100000 : 0) + (ch.votes || 0);
      for (const ch of chaptersData.items) {
        const existing = map.get(ch.number);
        if (!existing || score(ch) > score(existing)) map.set(ch.number, ch);
      }
      return Array.from(map.values()).sort((a, b) => b.number - a.number);
    }
    const filtered = chaptersData.items.filter(c => (c.scanlator || "Unknown") === selectedScanlator);
    if (!filtered.find(c => String(c.id) === chapterId)) return chaptersData.items;
    return filtered.sort((a, b) => b.number - a.number);
  }, [chaptersData, selectedScanlator, chapterId]);

  const chapterIndex = useMemo(() => navChapters.findIndex(c => String(c.id) === chapterId), [navChapters, chapterId]);
  const prevChapter = chapterIndex >= 0 && chapterIndex < navChapters.length - 1 ? navChapters[chapterIndex + 1] : null;
  const nextChapter = chapterIndex > 0 ? navChapters[chapterIndex - 1] : null;

  useEffect(() => {
    const isVertical = readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical';
    if (!isVertical || !nextChapter || loadingNextChapter) return;
    if (appendedIdsRef.current.has(nextChapter.id)) return;
    const totalPages = pagesData?.pages.length ?? 0;
    if (totalPages === 0 || currentPage < totalPages - 3) return;
    const nc = nextChapter;
    appendedIdsRef.current.add(nc.id);
    setLoadingNextChapter(true);
    fetch(`/api/chapter/${nc.id}/pages`, { headers: sourceId ? { "X-Source": sourceId } : {} })
      .then(r => r.json())
      .then((data: { pages: { index: number; url: string }[] }) => {
        setAppendedChapters(prev => [...prev, { id: nc.id, number: nc.number, title: nc.title ?? '', pages: data.pages }]);
      })
      .catch(() => { appendedIdsRef.current.delete(nc.id); })
      .finally(() => setLoadingNextChapter(false));
  }, [currentPage, nextChapter, pagesData, loadingNextChapter, readerSettings.direction]);

  const navigateToChapter = (id: string) => {
    setLocation(`/reader/${id}?mangaId=${mangaId}${sourceId ? `&sourceId=${sourceId}` : ""}`);
  };

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation(mangaId ? `/manga/${mangaId}` : "/");
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { goBack(); return; }
    const isPaginated = readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl';
    if (e.key === 'ArrowRight') {
      if (isPaginated && containerRef.current) {
        containerRef.current.scrollBy({ left: readerSettings.direction === 'ltr' ? containerRef.current.clientWidth : -containerRef.current.clientWidth, behavior: 'smooth' });
      }
    } else if (e.key === 'ArrowLeft') {
      if (isPaginated && containerRef.current) {
        containerRef.current.scrollBy({ left: readerSettings.direction === 'ltr' ? -containerRef.current.clientWidth : containerRef.current.clientWidth, behavior: 'smooth' });
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [readerSettings.direction]);

  if (pagesLoading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white/50">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Loading chapter pages...</p>
      </div>
    );
  }

  if (!pagesData || pagesData.pages.length === 0) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-4xl">📭</div>
        <h2 className="text-white text-lg font-bold">Chapter unavailable</h2>
        <p className="text-white/60 text-sm max-w-xs">
          This chapter's images couldn't be loaded. The site may require JavaScript to display pages, which our reader doesn't support yet.
        </p>
        <Button variant="outline" className="mt-2 text-white border-white/30 hover:bg-white/10" onClick={goBack}>
          Go Back
        </Button>
      </div>
    );
  }

  const bgClass = readerSettings.background === 'paper' ? 'bg-[#f4f1ea]' : readerSettings.background === 'black' ? 'bg-black' : 'bg-[#1a1a1a]';
  const textClass = readerSettings.background === 'paper' ? 'text-black' : 'text-white';
  const fitClass = readerSettings.fit === 'width' ? 'w-full h-auto' : readerSettings.fit === 'height' ? 'h-[100dvh] w-auto mx-auto' : 'w-auto h-auto mx-auto';

  const handlePageClick = (e: React.MouseEvent) => {
    const x = e.clientX;
    const w = window.innerWidth;
    if (readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl') {
      const goNext = readerSettings.direction === 'ltr' ? x > w / 2 : x < w / 2;
      if (containerRef.current) {
        containerRef.current.scrollBy({ left: goNext ? containerRef.current.clientWidth * (readerSettings.direction === 'rtl' ? -1 : 1) : -containerRef.current.clientWidth * (readerSettings.direction === 'rtl' ? -1 : 1), behavior: 'smooth' });
      }
    } else {
      setShowControls(!showControls);
    }
  };

  const currChapterObj = chaptersData?.items.find(c => String(c.id) === chapterId);

  return (
    <div className={`min-h-[100dvh] ${bgClass} relative select-none`} onClick={handlePageClick}>
      {/* Top Bar */}
      <div className={`fixed top-0 left-0 w-full z-50 transition-transform duration-300 ${showControls ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="bg-black/90 backdrop-blur border-b border-white/10 text-white flex items-center justify-between p-2 sm:px-4 h-14">
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <Button variant="ghost" size="icon" className="text-white/70 hover:text-white shrink-0" onClick={(e) => { e.stopPropagation(); goBack(); }}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex flex-col justify-center">
              <div className="text-xs text-white/50 truncate leading-none mb-1">{mangaData?.title || "Loading..."}</div>
              <div className="text-sm font-semibold truncate leading-none">Ch. {currChapterObj?.number} {currChapterObj?.title ? `- ${currChapterObj.title}` : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Button variant="ghost" size="icon" disabled={!prevChapter} onClick={(e) => { e.stopPropagation(); if (prevChapter) navigateToChapter(prevChapter.id); }} className="text-white/70 hover:text-white" title="Previous Chapter">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" disabled={!nextChapter} onClick={(e) => { e.stopPropagation(); if (nextChapter) navigateToChapter(nextChapter.id); }} className="text-white/70 hover:text-white" title="Next Chapter">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="text-white/70 hover:text-white ml-1" onClick={e => e.stopPropagation()}>
                  <Settings className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="w-[300px] sm:w-[400px]" onClick={e => e.stopPropagation()}>
                <SheetHeader><SheetTitle>Reader Settings</SheetTitle></SheetHeader>
                <div className="py-6 space-y-6">
                  <div className="space-y-3">
                    <Label>Reading Direction</Label>
                    <Select value={readerSettings.direction} onValueChange={(v: any) => storeActions.setReader({ direction: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="webtoon">Webtoon (Continuous)</SelectItem>
                        <SelectItem value="vertical">Vertical (Gaps)</SelectItem>
                        <SelectItem value="ltr">Left to Right</SelectItem>
                        <SelectItem value="rtl">Right to Left</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <Label>Image Fit</Label>
                    <Select value={readerSettings.fit} onValueChange={(v: any) => storeActions.setReader({ fit: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="width">Fit Width</SelectItem>
                        <SelectItem value="height">Fit Height</SelectItem>
                        <SelectItem value="original">Original Size</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <Label>Background</Label>
                    <Select value={readerSettings.background} onValueChange={(v: any) => storeActions.setReader({ background: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paper">Paper (Light)</SelectItem>
                        <SelectItem value="black">Black</SelectItem>
                        <SelectItem value="gray">Dark Gray</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Show Page Number</Label>
                    <Switch checked={readerSettings.showPageNumber} onCheckedChange={(v) => storeActions.setReader({ showPageNumber: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Keep Screen On</Label>
                    <Switch checked={readerSettings.keepScreenOn} onCheckedChange={(v) => storeActions.setReader({ keepScreenOn: v })} />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      {/* Pages Container */}
      <div
        ref={containerRef}
        className={`w-full ${
          readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl'
          ? 'h-[100dvh] flex overflow-x-auto snap-x snap-mandatory hide-scrollbar flex-row'
          : 'flex flex-col items-center max-w-3xl mx-auto'
        } ${readerSettings.direction === 'rtl' ? 'flex-row-reverse' : ''}`}
      >
        {pagesData.pages.map((page, idx) => {
          const isVerticalLike = readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical';
          const isLoaded = !!loadedImgs[idx];
          const isWebtoon = readerSettings.direction === 'webtoon';
          const isPaged = readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl';

          return (
            <div
              key={page.index}
              id={`page-${idx}`}
              className={`reader-page relative flex-shrink-0 ${
                isPaged
                ? 'flex items-center justify-center bg-black w-[100vw] h-[100dvh] snap-center snap-always'
                : isWebtoon ? 'w-full' : 'flex items-center justify-center bg-black w-full'
              } ${readerSettings.direction === 'vertical' ? 'mb-8' : ''}`}
            >
              {!isLoaded && (
                <div className="flex flex-col items-center justify-center min-h-[40vw] w-full bg-black text-white/40 pointer-events-none">
                  <Loader2 className="h-10 w-10 animate-spin" />
                  <div className="mt-3 text-xs tabular-nums">{idx + 1} / {pagesData.pages.length}</div>
                </div>
              )}
              {readerSettings.direction === 'vertical' && (
                <div className="absolute -bottom-6 text-xs text-muted-foreground">{idx + 1}</div>
              )}
              <img
                // ── ONE FIXED LINE ────────────────────────────────────────
                src={getProxiedImageUrl(page.url, sourceId ?? "")}
                alt={`Page ${page.index}`}
                className={`transition-opacity duration-200 ${isLoaded ? 'opacity-100' : 'opacity-0 absolute'}`}
                loading={isVerticalLike ? 'eager' : (idx < 3 ? 'eager' : 'lazy')}
                decoding="async"
                onLoad={() => setLoadedImgs((p) => (p[idx] ? p : { ...p, [idx]: true }))}
                onError={() => setLoadedImgs((p) => (p[idx] ? p : { ...p, [idx]: true }))}
                style={
                  isWebtoon
                    ? { display: 'block', width: '100%', height: 'auto', margin: 0, padding: 0, verticalAlign: 'top', lineHeight: 0 }
                    : { display: 'block', maxWidth: '100%', objectFit: 'contain' }
                }
              />
            </div>
          );
        })}

        {/* Continuous reading: appended chapters */}
        {(readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical') && appendedChapters.map((ch) => (
          <div key={ch.id} className="w-full">
            <div className="flex items-center gap-4 px-4 py-6 bg-black/80 border-y border-white/10">
              <div className="flex-1 h-px bg-white/20" />
              <div className="text-center">
                <div className="text-white/50 text-xs mb-1">Next Chapter</div>
                <div className="text-white font-semibold text-sm">Ch. {ch.number}{ch.title ? ` — ${ch.title}` : ''}</div>
              </div>
              <div className="flex-1 h-px bg-white/20" />
            </div>
            {ch.pages.map((page) => {
              const isWebtoon = readerSettings.direction === 'webtoon';
              return (
                <div
                  key={page.index}
                  className={`reader-page relative flex-shrink-0 ${
                    isWebtoon ? 'w-full' : 'flex items-center justify-center bg-black w-full mb-8'
                  }`}
                >
                  <img
                    // ── ONE FIXED LINE ────────────────────────────────────
                    src={getProxiedImageUrl(page.url, sourceId ?? "")}
                    alt={`Ch${ch.number} Page ${page.index}`}
                    loading="lazy"
                    decoding="async"
                    style={
                      isWebtoon
                        ? { display: 'block', width: '100%', height: 'auto', margin: 0, padding: 0, verticalAlign: 'top', lineHeight: 0 }
                        : { display: 'block', maxWidth: '100%', objectFit: 'contain' }
                    }
                  />
                </div>
              );
            })}
          </div>
        ))}

        {(readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical') && loadingNextChapter && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-white/50">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Loading next chapter…</span>
          </div>
        )}

        {(readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical') && !nextChapter && appendedChapters.length === 0 && (
          <div className="py-16 flex flex-col items-center gap-4 text-white/40">
            <div className="text-sm">You've reached the end</div>
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); goBack(); }}>
              Back to Manga
            </Button>
          </div>
        )}
      </div>

      {readerSettings.showPageNumber && showControls && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 backdrop-blur text-white text-xs font-medium z-40 pointer-events-none animate-in fade-in duration-200">
          {currentPage + 1} / {pagesData.pages.length}
        </div>
      )}
    </div>
  );
}