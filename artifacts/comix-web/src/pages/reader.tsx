import { useRoute, Link, useSearch, useLocation } from "wouter";
import {
  useGetChapterPages,
  useGetChapters,
  useGetMangaDetails,
  getGetChapterPagesQueryKey,
  getGetChaptersQueryKey,
  getGetMangaDetailsQueryKey,
} from "@workspace/api-client-react";
import { proxyImage } from "@/lib/utils";
import { Loader2, X, Settings, ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { useStore, storeActions, ReaderSettings } from "@/lib/storage";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export default function Reader() {
  const [, params] = useRoute("/reader/:chapterId");
  const chapterId = parseInt(params?.chapterId || "0");
  const searchString = useSearch();
  const mangaId = new URLSearchParams(searchString).get("mangaId");
  const [, setLocation] = useLocation();

  const readerSettings = useStore(s => s.reader);
  const progressMap = useStore(s => s.progress);
  const scanlatorPrefs = useStore(s => s.scanlatorPrefs);
  const progressKey = `${mangaId}:${chapterId}`;
  const currentProgress = progressMap[progressKey];
  const selectedScanlator = mangaId ? (scanlatorPrefs[mangaId] ?? null) : null;

  const [showControls, setShowControls] = useState(true);
  const [currentPage, setCurrentPage] = useState(currentProgress?.lastPageRead || 0);

  // Map of page index -> natural { w, h } of the image. We probe these BEFORE rendering so
  // each page slot can reserve its exact aspect ratio. This eliminates the "shake" where
  // an unloaded slot suddenly grows when its image arrives, and removes the dark filler
  // gap that came from the old min-height placeholder.
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>(() => {
    // Hydrate from a per-chapter localStorage cache so re-reads are perfectly shake-free.
    try {
      const raw = localStorage.getItem(`comix:page-dims:${chapterId}`);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });
  // Track which images are fully decoded and visible
  const [loadedImgs, setLoadedImgs] = useState<Record<number, boolean>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const { data: pagesData, isLoading: pagesLoading } = useGetChapterPages(chapterId.toString(), {
    query: {
      enabled: !!chapterId,
      queryKey: getGetChapterPagesQueryKey(chapterId.toString()),
    },
  });

  // Match the manga-detail page: fetch ALL chapters (dedupe=false) so we can apply
  // the same scanlator filter for prev/next navigation, and share the React Query cache.
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

  // Track real reading time. Adds the elapsed wall-clock time to global stats
  // every few seconds, but pauses while the tab is hidden so it doesn't count
  // time when the user has switched away.
  useEffect(() => {
    const TICK_MS = 5000;
    let lastTick = document.visibilityState === 'visible' ? Date.now() : null;

    const flush = () => {
      if (lastTick === null) return;
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;
      // Cap any single tick at 60s — avoids dumping a giant chunk if the
      // browser throttled the timer or the tab was idle for a long time.
      if (delta > 0) storeActions.addReadingTime(Math.min(delta, 60_000));
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastTick = Date.now();
      } else {
        flush();
        lastTick = null;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(flush, TICK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
      flush();
    };
  }, []);

  // Keep screen on
  useEffect(() => {
    if (!(readerSettings.keepScreenOn && 'wakeLock' in navigator)) {
      return;
    }
    {
      const requestWakeLock = async () => {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.error(err);
        }
      };
      requestWakeLock();
      
      const handleVisibilityChange = () => {
        if (wakeLockRef.current !== null && document.visibilityState === 'visible') {
          requestWakeLock();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        wakeLockRef.current?.release();
        wakeLockRef.current = null;
      };
    }
  }, [readerSettings.keepScreenOn]);

  // Probe every page's natural dimensions in parallel so we can reserve exact aspect-ratio
  // boxes BEFORE the <img> elements render. The browser caches the loaded image, so the
  // real <img> tag below renders instantly from cache without any layout shift.
  // Persisted to localStorage per-chapter, so re-reads have ZERO layout shift.
  useEffect(() => {
    if (!pagesData?.pages.length) return;
    let cancelled = false;
    const persist = (() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return (next: Record<number, { w: number; h: number }>) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          try { localStorage.setItem(`comix:page-dims:${chapterId}`, JSON.stringify(next)); } catch {}
        }, 250);
      };
    })();
    pagesData.pages.forEach((page, idx) => {
      // Skip pages whose dimensions we already cached
      if (pageDims[idx]) return;
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = () => {
        if (cancelled) return;
        setPageDims(prev => {
          if (prev[idx]) return prev;
          const next = { ...prev, [idx]: { w: probe.naturalWidth || 800, h: probe.naturalHeight || 1200 } };
          persist(next);
          return next;
        });
      };
      probe.onerror = () => {
        if (cancelled) return;
        setPageDims(prev => {
          if (prev[idx]) return prev;
          const next = { ...prev, [idx]: { w: 800, h: 1200 } };
          persist(next);
          return next;
        });
      };
      probe.src = proxyImage(page.url);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesData, chapterId]);

  // Computed ONCE from the initial pageDims (which is pre-populated from localStorage).
  // Using [] deps means this NEVER recalculates — so when probes arrive one-by-one,
  // only the individual slot whose probe just finished changes size. Previously this
  // recalculated on every probe, causing ALL unprobed slots to resize in cascade → shake.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fallbackAspect = useMemo(() => {
    const measured = Object.values(pageDims);
    if (!measured.length) return { w: 720, h: 1080 };
    const sorted = measured
      .map((d) => d.h / Math.max(1, d.w))
      .sort((a, b) => a - b);
    const ratio = sorted[Math.floor(sorted.length / 2)];
    return { w: 1000, h: Math.round(1000 * ratio) };
  }, []); // ← intentionally empty: stable after mount

  // Track the last-committed dims so we know what changed each render.
  // Initialized with the current pageDims (from localStorage) so the first
  // useLayoutEffect run has a correct baseline.
  const prevPageDimsRef = useRef<Record<number, { w: number; h: number }>>({ ...pageDims });

  // Scroll compensation: when a page's aspect-ratio box changes height and that page is
  // above the midpoint of the viewport, compensate window.scrollY instantly.
  // Runs synchronously after DOM mutations but before the browser paints, so there's
  // no visible flash of the shifted layout.
  useLayoutEffect(() => {
    const isVertical = readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical';
    if (!isVertical) { prevPageDimsRef.current = { ...pageDims }; return; }

    let delta = 0;
    for (const [key, dim] of Object.entries(pageDims)) {
      const idx = Number(key);
      const prev = prevPageDimsRef.current[idx] ?? fallbackAspect;
      if (prev.w === dim.w && prev.h === dim.h) continue; // no change
      const el = document.getElementById(`page-${idx}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      // Only compensate for pages completely above the viewport top.
      if (rect.bottom <= 0) {
        const w = el.clientWidth || window.innerWidth;
        delta += (w * dim.h / Math.max(1, dim.w)) - (w * prev.h / Math.max(1, prev.w));
      }
    }
    prevPageDimsRef.current = { ...pageDims };
    if (Math.abs(delta) >= 1) {
      window.scrollBy({ top: Math.round(delta), behavior: 'instant' as ScrollBehavior });
    }
  }, [pageDims]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial scroll — wait until we've measured the page we want to land on so the
  // scrollIntoView lands at the right pixel and doesn't get nudged later.
  useEffect(() => {
    if (!pagesData?.pages.length) return;
    const target = currentProgress?.lastPageRead;
    if (!target || target === 0) return;

    // For paginated modes we can scroll immediately (every page is one viewport wide).
    if (readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl') {
      if (containerRef.current) {
        containerRef.current.scrollTo({
          left: (readerSettings.direction === 'ltr' ? target : -target) * containerRef.current.clientWidth,
        });
      }
      return;
    }

    // For vertical / webtoon: wait until ALL preceding pages have known dimensions so
    // their reserved heights are accurate. Otherwise we'd land in the wrong place.
    let allKnown = true;
    for (let i = 0; i <= target; i++) {
      if (!pageDims[i]) { allKnown = false; break; }
    }
    if (!allKnown) return;

    const pageEl = document.getElementById(`page-${target}`);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [pagesData, currentProgress?.lastPageRead, readerSettings.direction, pageDims]);

  // Scroll tracking
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
            // If top is above middle of screen and bottom is below middle
            if (rect.top <= wh / 2 && rect.bottom >= wh / 2) {
              newPage = i;
              break;
            }
          }

          // Check if at bottom (90%)
          const docHeight = document.documentElement.scrollHeight;
          if (scrollY + wh >= docHeight * 0.9) {
             const ch = chaptersData.items.find(c => c.id === chapterId);
             if (ch) {
               storeActions.markChapterRead(mangaId, ch, mangaData, pagesData.pages.length);
             }
          }
        } else {
          // LTR / RTL
          if (containerRef.current) {
            const scrollX = Math.abs(containerRef.current.scrollLeft);
            const cw = containerRef.current.clientWidth;
            newPage = Math.round(scrollX / cw);
            
            if (newPage >= pagesData.pages.length - 1) {
              const ch = chaptersData.items.find(c => c.id === chapterId);
               if (ch) {
                 storeActions.markChapterRead(mangaId, ch, mangaData, pagesData.pages.length);
               }
            }
          }
        }

        if (newPage !== currentPage) {
          setCurrentPage(newPage);
          const ch = chaptersData.items.find(c => c.id === chapterId);
          if (ch && !currentProgress?.isRead) {
            storeActions.recordProgress({
              mangaId,
              chapterId: ch.id,
              chapterNumber: ch.number,
              chapterTitle: ch.title,
              mangaTitle: mangaData.title,
              mangaThumbnail: mangaData.thumbnail,
              totalPages: pagesData.pages.length,
              lastPageRead: newPage,
              isRead: false
            });
          }
        }
      }, 500);
    };

    const container = readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical' ? window : containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
    }
    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout.current);
    };
  }, [readerSettings.direction, pagesData, mangaId, chaptersData, mangaData, currentPage, currentProgress?.isRead]);


  // Navigation — apply the same scanlator filter the user picked on the manga page.
  // If the user is reading a chapter from a source that's filtered out, fall back to
  // showing all chapters so we can still find prev/next.
  const navChapters = useMemo<any[]>(() => {
    if (!chaptersData?.items) return [];
    if (!selectedScanlator) {
      // No source selected — dedupe so prev/next don't jump between sources of the same chapter.
      const map = new Map<number, any>();
      const score = (ch: any) => (ch.isOfficial ? 100000 : 0) + (ch.votes || 0);
      for (const ch of chaptersData.items) {
        const existing = map.get(ch.number);
        if (!existing || score(ch) > score(existing)) map.set(ch.number, ch);
      }
      // Keep newest-first like the API
      return Array.from(map.values()).sort((a, b) => b.number - a.number);
    }
    const filtered = chaptersData.items.filter(c => (c.scanlator || "Unknown") === selectedScanlator);
    if (!filtered.find(c => c.id === chapterId)) {
      // Reading something outside the chosen source; use all chapters so navigation works
      return chaptersData.items;
    }
    return filtered.sort((a, b) => b.number - a.number);
  }, [chaptersData, selectedScanlator, chapterId]);

  const chapterIndex = useMemo(() => {
    return navChapters.findIndex(c => c.id === chapterId);
  }, [navChapters, chapterId]);

  const prevChapter = chapterIndex >= 0 && chapterIndex < navChapters.length - 1 ? navChapters[chapterIndex + 1] : null;
  const nextChapter = chapterIndex > 0 ? navChapters[chapterIndex - 1] : null;

  const navigateToChapter = (id: number) => {
    setLocation(`/reader/${id}?mangaId=${mangaId}`);
  };

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation(mangaId ? `/manga/${mangaId}` : "/");
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      goBack();
      return;
    }
    
    const isPaginated = readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl';
    
    if (e.key === 'ArrowRight') {
      if (isPaginated && containerRef.current) {
         if (readerSettings.direction === 'ltr') {
           containerRef.current.scrollBy({ left: containerRef.current.clientWidth, behavior: 'smooth' });
         } else {
           containerRef.current.scrollBy({ left: -containerRef.current.clientWidth, behavior: 'smooth' });
         }
      }
    } else if (e.key === 'ArrowLeft') {
      if (isPaginated && containerRef.current) {
         if (readerSettings.direction === 'ltr') {
           containerRef.current.scrollBy({ left: -containerRef.current.clientWidth, behavior: 'smooth' });
         } else {
           containerRef.current.scrollBy({ left: containerRef.current.clientWidth, behavior: 'smooth' });
         }
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
        const scrollAmount = containerRef.current.clientWidth * (readerSettings.direction === 'rtl' ? -1 : 1);
        containerRef.current.scrollBy({ left: goNext ? scrollAmount : -scrollAmount, behavior: 'smooth' });
      }
    } else {
      setShowControls(!showControls);
    }
  };

  const currChapterObj = chaptersData?.items.find(c => c.id === chapterId);

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
                <SheetHeader>
                  <SheetTitle>Reader Settings</SheetTitle>
                </SheetHeader>
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
        style={
          readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical'
            ? { overflowAnchor: 'none' as const }
            : undefined
        }
      >
        {pagesData.pages.map((page, idx) => {
          const isVerticalLike = readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical';
          const dim = pageDims[idx] ?? fallbackAspect;
          const isLoaded = !!loadedImgs[idx];

          // Wrapper style: for vertical/webtoon modes reserve an EXACT aspect-ratio box
          // for every page (using either the real measurement or the median fallback).
          // The slot's size never changes after first render, so neighbouring pages
          // never shift while you're reading.
          const wrapperStyle: React.CSSProperties | undefined = isVerticalLike
            ? { aspectRatio: `${dim.w} / ${dim.h}`, width: '100%' }
            : undefined;

          const isWebtoon = readerSettings.direction === 'webtoon';
          const isPaged = readerSettings.direction === 'ltr' || readerSettings.direction === 'rtl';

          return (
            <div
              key={page.index}
              id={`page-${idx}`}
              className={`reader-page relative flex-shrink-0 ${
                isPaged
                ? 'flex items-center justify-center bg-black w-[100vw] h-[100dvh] snap-center snap-always'
                : isWebtoon
                  ? 'w-full'
                  : 'flex items-center justify-center bg-black w-full'
              } ${readerSettings.direction === 'vertical' ? 'mb-8' : ''}`}
              style={wrapperStyle}
            >
              {/* Dark loading shell with spinner */}
              {!isLoaded && (
                <div className={`${isWebtoon ? 'absolute inset-0' : 'absolute inset-0'} flex flex-col items-center justify-center bg-black text-white/40 pointer-events-none`}>
                  <Loader2 className="h-10 w-10 animate-spin" />
                  <div className="mt-3 text-xs tabular-nums">{idx + 1} / {pagesData.pages.length}</div>
                </div>
              )}

              {readerSettings.direction === 'vertical' && (
                <div className="absolute -bottom-6 text-xs text-muted-foreground">{idx + 1}</div>
              )}
              <img
                src={proxyImage(page.url)}
                alt={`Page ${page.index}`}
                width={dim.w}
                height={dim.h}
                className={`transition-opacity duration-200 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
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
      </div>

      {/* Next Chapter Button at bottom (Webtoon/Vertical) */}
      {(readerSettings.direction === 'webtoon' || readerSettings.direction === 'vertical') && nextChapter && (
        <div className="py-20 flex justify-center">
          <Button size="lg" onClick={(e) => { e.stopPropagation(); navigateToChapter(nextChapter.id); }}>
            Next Chapter
          </Button>
        </div>
      )}

      {/* Page Indicator — hidden along with the rest of the UI when controls are toggled off */}
      {readerSettings.showPageNumber && showControls && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 backdrop-blur text-white text-xs font-medium z-40 pointer-events-none animate-in fade-in duration-200">
          {currentPage + 1} / {pagesData.pages.length}
        </div>
      )}
    </div>
  );
}
