import { useRoute, useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetChapterPages,
  useGetChapters,
  useGetMangaDetails,
  getGetChapterPagesQueryKey,
  getGetChaptersQueryKey,
  getGetMangaDetailsQueryKey,
  setExtraHeader,
  customFetch,
  type ChapterPage,
} from "@workspace/api-client-react";
import { mediaImage, readerUrl } from "@/lib/utils";
import { apiUrl } from "@/lib/api-url";
import { getClientSourceAdapter } from "@/lib/client-sources";
import { PageTranslationOverlay, ReaderRegionSelector, ReaderTranslationControl, type NormalizedRect, type TranslationRegion } from "@/components/reader/page-translation";
import { TranslationLanguagePicker } from "@/components/reader/translation-language-picker";
import VideoPlayer, { type VideoTrack } from "@/pages/video-player";
import { Bookmark, BookmarkCheck, Loader2, MessageCircle, X, Settings, ChevronLeft, ChevronRight, Menu, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback, type CSSProperties } from "react";
import { useStore, storeActions, ReaderSettings } from "@/lib/storage";
import { ReaderCommentsSheet } from "@/components/reader/reader-comments-sheet";
import { offlineDb } from "@/lib/offline-db";
import { getSavedTranslationTargetLanguage, saveTranslationTargetLanguage, TARGET_LANGUAGE_OPTIONS } from "@/lib/translation-languages";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";

interface ImmersiveModePlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
}

const ImmersiveMode = registerPlugin<ImmersiveModePlugin>("ImmersiveMode");

function resolveReaderMediaUrl(url: string, sourceId?: string | null): string {
  if (url.startsWith("/")) return apiUrl(url);
  return mediaImage(url, sourceId ?? undefined);
}

export default function Reader() {
  const [, params] = useRoute("/reader/:chapterId");
  const chapterId = params?.chapterId ? decodeURIComponent(params.chapterId) : "";
  const searchString = useSearch();
  const mangaId = new URLSearchParams(searchString).get("mangaId");
  const sourceIdFromUrl = new URLSearchParams(searchString).get("sourceId");
  const isOfflineMode = new URLSearchParams(searchString).get("offline") === "1";
  const [, setLocation] = useLocation();

  // Offline mode: load pages from IndexedDB instead of the API
  const [offlinePages, setOfflinePages] = useState<{ index: number; url: string }[] | null>(null);
  const [offlineChapter, setOfflineChapter] = useState<Awaited<ReturnType<typeof offlineDb.get>>>(null);
  const [offlineLoading, setOfflineLoading] = useState(isOfflineMode);
  useEffect(() => {
    if (!isOfflineMode || !chapterId) return;
    setOfflineLoading(true);
    offlineDb.get(String(chapterId)).then(chapter => {
      if (chapter?.pageUrls?.length) {
        setOfflineChapter(chapter);
        setOfflinePages(
          chapter.pages?.length
            ? chapter.pages
            : chapter.pageUrls.map((url, i) => ({ index: i, url })),
        );
      }
      setOfflineLoading(false);
    }).catch(() => setOfflineLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  // Fallback: if sourceId isn't in the URL (e.g. opened from history before
  // the fix), grab it from the library entry for this manga.
  const library = useStore(s => s.library);
  const sourceId = sourceIdFromUrl ?? (mangaId ? (library[mangaId]?.sourceId ?? null) : null);
  const clientAdapter = getClientSourceAdapter(sourceId ?? "");
  const isNativeApp = Capacitor.isNativePlatform();
  const activeRouteKey = `${sourceId ?? ""}\n${chapterId}`;
  const activeRouteKeyRef = useRef(activeRouteKey);
  activeRouteKeyRef.current = activeRouteKey;

  // Set synchronously (not in useEffect) so the header is present on the
  // very first render when useGetChapterPages fires its query.
  if (sourceId) setExtraHeader("X-Source", sourceId);

  useEffect(() => {
    if (sourceId) setExtraHeader("X-Source", sourceId);
  }, [sourceId]);

  const readerSettings = useStore(s => s.reader);
  const [novelBackground, setNovelBackground] = useState<"dark" | "light">("dark");
  const sourceReaderDirections = useStore(s => s.sourceReaderDirections);
  const isRule34 = sourceId === "en.rule34";
  // Rule34 defaults to LTR (single-image posts look terrible in webtoon mode).
  // The user can still change it from the reader settings panel — that change
  // is stored per-source so it never bleeds into other sources.
  const effectiveDirection = isRule34
    ? ((sourceReaderDirections ?? {})["en.rule34"] ?? "ltr")
    : readerSettings.direction;
  const progressMap = useStore(s => s.progress);
  const scanlatorPrefs = useStore(s => s.scanlatorPrefs);
  const chapterFavorites = useStore(s => s.chapterFavorites);
  const progressKey = `${mangaId}:${chapterId}`;
  const currentProgress = progressMap[progressKey];
  const selectedScanlator = mangaId ? (scanlatorPrefs[mangaId] ?? null) : null;

  const [showControls, setShowControls] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageTranslations, setPageTranslations] = useState<Record<number, TranslationRegion[]>>({});
  const [visiblePageIndices, setVisiblePageIndices] = useState<number[]>([]);
  const [aiTranslationEnabled, setAiTranslationEnabled] = useState(() => {
    try { return localStorage.getItem("comihub-ai-page-translation-v2") === "true"; }
    catch { return false; }
  });
  const [translationTargetLanguage, setTranslationTargetLanguage] = useState(getSavedTranslationTargetLanguage);

  useEffect(() => {
    saveTranslationTargetLanguage(translationTargetLanguage);
  }, [translationTargetLanguage]);

  useEffect(() => {
    try { localStorage.setItem("comihub-ai-page-translation-v2", String(aiTranslationEnabled)); }
    catch { /* Private browsing may disable local storage; the reader still works. */ }
    if (!aiTranslationEnabled) setPageTranslations({});
  }, [aiTranslationEnabled]);

  const handlePageTranslated = useCallback((pageIndex: number, regions: TranslationRegion[]) => {
    setPageTranslations(previous => ({ ...previous, [pageIndex]: regions }));
  }, []);
  const clearPageTranslation = useCallback((pageIndex: number) => {
    setPageTranslations(previous => {
      const next = { ...previous };
      delete next[pageIndex];
      return next;
    });
  }, []);
  const clearAllPageTranslations = useCallback(() => setPageTranslations({}), []);

  // "One bubble" mode: the reader owns the drag layer over the current page and
  // hands the finished box to the translation control, which sends only that crop.
  const [regionSelecting, setRegionSelecting] = useState(false);
  const [regionTargetPage, setRegionTargetPage] = useState(0);
  const [selectionRequest, setSelectionRequest] = useState<{ rect: NormalizedRect; pageIndex: number; existingRegions: TranslationRegion[]; nonce: number } | null>(null);
  const selectionNonceRef = useRef(0);
  const requestRegionSelection = useCallback(() => {
    setRegionTargetPage(currentPage);
    setRegionSelecting(true);
    setShowControls(false);
  }, [currentPage]);
  const cancelRegionSelection = useCallback(() => setRegionSelecting(false), []);
  const handleRegionSelected = useCallback((rect: NormalizedRect) => {
    setRegionSelecting(false);
    selectionNonceRef.current += 1;
    setSelectionRequest(previous => ({
      rect,
      pageIndex: regionTargetPage,
      existingRegions: pageTranslations[regionTargetPage] ?? previous?.existingRegions ?? [],
      nonce: selectionNonceRef.current,
    }));
  }, [regionTargetPage, pageTranslations]);
  const handleSelectionHandled = useCallback(() => setSelectionRequest(null), []);

  // The Android shell can hide both native system bars through its Capacitor
  // bridge. Browsers and PWAs retain the document Fullscreen API fallback.
  const toggleReaderControls = async (next?: boolean) => {
    const shouldShow = next ?? !showControls;
    setShowControls(shouldShow);
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      try {
        await ImmersiveMode.setEnabled({ enabled: !shouldShow });
      } catch {
        // Keep the reader usable if an older installed shell lacks this bridge.
      }
      return;
    }
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
      try {
        if (shouldShow) await StatusBar.show();
        else await StatusBar.hide();
      } catch {
        // Keep the reader usable if native status-bar control is unavailable.
      }
      return;
    }
    try {
      if (shouldShow) {
        if (document.fullscreenElement) await document.exitFullscreen();
      } else if (!document.fullscreenElement) {
        const root = document.documentElement as any;
        if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
      }
    } catch {
      // Some browsers require their own fullscreen permission or do not support it.
      // The toolbar still hides normally even when system chrome cannot be hidden.
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setShowControls(true);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
        void ImmersiveMode.setEnabled({ enabled: false }).catch(() => undefined);
      } else if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
        void StatusBar.show().catch(() => undefined);
      }
    };
  }, []);
  const [loadedImgs, setLoadedImgs] = useState<Record<number, boolean>>({});
  const [failedImgs, setFailedImgs] = useState<Record<number, boolean>>({});
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({});

  type AppendedChapter = { id: string; number: number; title: string; pages: { index: number; url: string }[] };
  const [appendedChapters, setAppendedChapters] = useState<AppendedChapter[]>([]);
  const [loadingNextChapter, setLoadingNextChapter] = useState(false);
  const appendedIdsRef = useRef<Set<string>>(new Set());
  const novelEndHandledRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Stores measured heights of rendered pages so off-screen placeholders keep correct scroll position
  const pageHeightsRef = useRef<Record<number, number>>({});
  const novelScrollRestoredRef = useRef(false);

  useLayoutEffect(() => {
    setPageTranslations({});
    setVisiblePageIndices([]);
    setAppendedChapters([]);
    setLoadingNextChapter(false);
    appendedIdsRef.current.clear();
    setLoadedImgs({});
    setFailedImgs({});
    setRetryCounts({});
    setCurrentPage(0);
    pageHeightsRef.current = {};
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
  }, [chapterId, sourceId]);

  const retryPage = (idx: number) => {
    setFailedImgs(prev => ({ ...prev, [idx]: false }));
    setLoadedImgs(prev => ({ ...prev, [idx]: false }));
    setRetryCounts(prev => ({ ...prev, [idx]: (prev[idx] ?? 0) + 1 }));
  };

  const imageUrlWithRetry = (url: string, idx: number) => {
    const retry = retryCounts[idx] ?? 0;
    if (!retry) return url;
    return `${url}${url.includes("?") ? "&" : "?"}retry=${retry}`;
  };

  const handlePageImageLoad = (idx: number, event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const page = image.closest(".reader-page") as HTMLElement | null;
    const previousHeight = pageHeightsRef.current[idx];
    const height = Math.round(image.getBoundingClientRect().height);
    if (height > 0) {
      pageHeightsRef.current[idx] = height;
      if (page && previousHeight && previousHeight !== height && page.getBoundingClientRect().top < 0) {
        window.scrollBy(0, height - previousHeight);
      }
    }
    setLoadedImgs(prev => (prev[idx] ? prev : { ...prev, [idx]: true }));
  };

  // Webtoon pages can use the native HTTP bridge in the app. The server route
  // remains a temporary fallback for ordinary browsers, where CORS still applies.
  const webtoonPagesUseServer = sourceId === "all.webtoons" && !isNativeApp;
  const clientPagesQuery = useQuery({
    queryKey: ["client-pages", sourceId, chapterId],
    queryFn: () => clientAdapter?.pages
      ? clientAdapter.pages(chapterId).catch(error => {
          if ((isNativeApp && !clientAdapter.fallbackToServerOnNative) || clientAdapter.fallbackToServer === false) throw error;
          return customFetch<any>(`/api/chapter/${encodeURIComponent(chapterId)}/pages`, {
            headers: sourceId ? { "X-Source": sourceId } : undefined,
          });
        })
      : Promise.reject(new Error("Client pages unavailable")),
    enabled: !isOfflineMode && !!chapterId && chapterId !== "0" && !!clientAdapter?.pages && !webtoonPagesUseServer,
    staleTime: 5 * 60 * 1000,
  });
  const serverPagesQuery = useGetChapterPages(chapterId, {
    query: {
      // Skip API when reading offline or when this source has a client page adapter.
      enabled: !isNativeApp && !isOfflineMode && !!chapterId && chapterId !== "0" && (!clientAdapter?.pages || webtoonPagesUseServer),
      queryKey: getGetChapterPagesQueryKey(chapterId),
    },
  });
  const pagesData = clientPagesQuery.data ?? serverPagesQuery.data;
  const pagesLoading = clientPagesQuery.isLoading || ((!clientAdapter?.pages || webtoonPagesUseServer) && serverPagesQuery.isLoading);
  const pagesError = clientPagesQuery.error ?? ((!clientAdapter?.pages || webtoonPagesUseServer) ? serverPagesQuery.error : null);

  // Unified pages array: offline IndexedDB data OR live API data
  const effectivePages: Array<ChapterPage & { videoTracks?: VideoTrack[] }> =
    (isOfflineMode && offlinePages) ? offlinePages : (pagesData?.pages ?? []);
  const effectiveLoading = isOfflineMode ? offlineLoading : pagesLoading;
  const effectiveError = isOfflineMode ? null : pagesError;
  const translationPages = useMemo(() => {
    const pages = effectivePages.map((page, index) => ({
      url: page.url,
      loaded: !!loadedImgs[index],
      failed: !!failedImgs[index],
      chapterId,
      pageIndex: index,
    }));
    if (effectiveDirection === "webtoon" || effectiveDirection === "vertical") {
      let globalIndex = effectivePages.length;
      for (const chapter of appendedChapters) {
        chapter.pages.forEach((page, pageIndex) => {
          pages.push({
            url: page.url,
            loaded: !!loadedImgs[globalIndex],
            failed: !!failedImgs[globalIndex],
            chapterId: chapter.id,
            pageIndex,
          });
          globalIndex += 1;
        });
      }
    }
    return pages;
  }, [effectivePages, appendedChapters, loadedImgs, failedImgs, chapterId, effectiveDirection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!aiTranslationEnabled || !container || typeof IntersectionObserver === "undefined") {
      setVisiblePageIndices([]);
      return;
    }
    const visible = new Set<number>();
    const isPaged = effectiveDirection === "ltr" || effectiveDirection === "rtl";
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.readerPageIndex);
        if (!Number.isInteger(index)) continue;
        if (entry.isIntersecting) visible.add(index);
        else visible.delete(index);
      }
      setVisiblePageIndices(Array.from(visible).sort((a, b) => a - b));
    }, { root: isPaged ? container : null, threshold: 0.01 });
    container.querySelectorAll<HTMLElement>("[data-reader-page-index]").forEach(page => observer.observe(page));
    return () => observer.disconnect();
  }, [effectivePages, appendedChapters, currentPage, effectiveDirection, aiTranslationEnabled]);

  const chapterFetchParams = { dedupe: false };
  const clientChaptersQuery = useQuery({
    queryKey: ["reader-client-chapters", sourceId, mangaId],
    queryFn: () => clientAdapter!.chapters!(mangaId!).catch(error => {
      if ((isNativeApp && !clientAdapter!.fallbackToServerOnNative) || clientAdapter!.fallbackToServer === false) throw error;
      return customFetch<any>(`/api/manga/${encodeURIComponent(mangaId!)}/chapters?dedupe=false`, {
        headers: sourceId ? { "X-Source": sourceId } : undefined,
      });
    }),
    enabled: isNativeApp && !!mangaId && !isOfflineMode && !!clientAdapter?.chapters,
    staleTime: 60 * 1000,
  });
  const { data: serverChaptersData } = useGetChapters(mangaId || "", chapterFetchParams, {
    query: {
      enabled: !isNativeApp && !!mangaId && !isOfflineMode,
      queryKey: getGetChaptersQueryKey(mangaId || "", chapterFetchParams),
    },
  });

  const clientMangaQuery = useQuery({
    queryKey: ["reader-client-manga", sourceId, mangaId],
    queryFn: () => clientAdapter!.details!(mangaId!).catch(error => {
      if ((isNativeApp && !clientAdapter!.fallbackToServerOnNative) || clientAdapter!.fallbackToServer === false) throw error;
      return customFetch<any>(`/api/manga/${encodeURIComponent(mangaId!)}`, {
        headers: sourceId ? { "X-Source": sourceId } : undefined,
      });
    }),
    enabled: isNativeApp && !!mangaId && !isOfflineMode && !!clientAdapter?.details,
    staleTime: 5 * 60 * 1000,
  });
  const { data: serverMangaData } = useGetMangaDetails(mangaId || "", undefined, {
    query: {
      enabled: !isNativeApp && !!mangaId && !isOfflineMode,
      queryKey: getGetMangaDetailsQueryKey(mangaId || ""),
    },
  });
  const chaptersData = clientChaptersQuery.data ?? serverChaptersData;
  const mangaData = clientMangaQuery.data ?? serverMangaData;

  const offlineChapterMetadata = offlineChapter
    ? {
        id: offlineChapter.chapterId,
        number: offlineChapter.chapterNumber,
        title: offlineChapter.chapterTitle,
        scanlator: "Downloaded",
      }
    : null;
  const effectiveMangaData = mangaData ?? (mangaId ? library[mangaId] : null);
  const effectiveChapterData: any[] = chaptersData?.items ?? (offlineChapterMetadata ? [offlineChapterMetadata] : []);

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
      catch { /* Wake lock is optional. */ }
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
  useLayoutEffect(() => {
    didInitialScroll.current = true;
    setCurrentPage(0);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (containerRef.current) containerRef.current.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [chapterId]);

  useEffect(() => {
    const handleScroll = () => {
      if (!effectivePages.length || !mangaId || !effectiveChapterData.length || !effectiveMangaData) return;
      clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => {
        const container = effectiveDirection === 'webtoon' || effectiveDirection === 'vertical' ? window : containerRef.current;
        if (!container) return;
        let newPage = currentPage;
        if (effectiveDirection === 'webtoon' || effectiveDirection === 'vertical') {
          const scrollY = window.scrollY;
          const wh = window.innerHeight;
          const pageElements = Array.from(document.querySelectorAll('.reader-page'));
          for (let i = 0; i < pageElements.length; i++) {
            const rect = pageElements[i].getBoundingClientRect();
            if (rect.top <= wh / 2 && rect.bottom >= wh / 2) { newPage = i; break; }
          }
          const docHeight = document.documentElement.scrollHeight;
          if (scrollY + wh >= docHeight * 0.9) {
            const ch = effectiveChapterData.find(c => String(c.id) === chapterId);
            if (ch) storeActions.markChapterRead(mangaId, ch, effectiveMangaData, effectivePages.length);
          }
        } else {
          if (containerRef.current) {
            const scrollX = Math.abs(containerRef.current.scrollLeft);
            const cw = containerRef.current.clientWidth;
            newPage = Math.round(scrollX / cw);
            if (newPage >= effectivePages.length - 1) {
              const ch = effectiveChapterData.find(c => String(c.id) === chapterId);
              if (ch) storeActions.markChapterRead(mangaId, ch, effectiveMangaData, effectivePages.length);
            }
          }
        }
        if (newPage !== currentPage) {
          setCurrentPage(newPage);
          const ch = effectiveChapterData.find(c => String(c.id) === chapterId);
          if (ch && !currentProgress?.isRead) {
            storeActions.recordProgress({
              mangaId, chapterId: ch.id, chapterNumber: ch.number,
              chapterTitle: ch.title, mangaTitle: effectiveMangaData.title,
              mangaThumbnail: effectiveMangaData.thumbnail, totalPages: effectivePages.length,
              lastPageRead: newPage, isRead: false,
            });
          }
        }
      }, 500);
    };
    const container = effectiveDirection === 'webtoon' || effectiveDirection === 'vertical' ? window : containerRef.current;
    if (container) container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout.current);
    };
  }, [effectiveDirection, pagesData, mangaId, effectiveChapterData, effectiveMangaData, currentPage, currentProgress?.isRead]);

  const sameChapterId = (a: unknown, b: unknown) => {
    const decode = (value: unknown) => {
      const text = String(value ?? "");
      try { return decodeURIComponent(text); } catch { return text; }
    };
    return decode(a) === decode(b);
  };
  const navChapters = useMemo<any[]>(() => {
    if (!effectiveChapterData.length) return [];
    if (!selectedScanlator) {
      const map = new Map<number, any>();
      const score = (ch: any) => (ch.isOfficial ? 100000 : 0) + (ch.votes || 0);
      for (const ch of effectiveChapterData) {
        const existing = map.get(ch.number);
        if (!existing || score(ch) > score(existing)) map.set(ch.number, ch);
      }
      return Array.from(map.values()).sort((a, b) => b.number - a.number);
    }
    const filtered = effectiveChapterData.filter(c => (c.scanlator || "Unknown") === selectedScanlator);
    if (!filtered.find(c => sameChapterId(c.id, chapterId))) return effectiveChapterData;
    return filtered.sort((a, b) => b.number - a.number);
  }, [effectiveChapterData, selectedScanlator, chapterId]);

  const chapterIndex = useMemo(() => navChapters.findIndex(c => sameChapterId(c.id, chapterId)), [navChapters, chapterId]);
  const prevChapter = chapterIndex >= 0 && chapterIndex < navChapters.length - 1 ? navChapters[chapterIndex + 1] : null;
  const nextChapter = chapterIndex > 0 ? navChapters[chapterIndex - 1] : null;

  useEffect(() => {
    const isVertical = effectiveDirection === 'webtoon' || effectiveDirection === 'vertical';
    if (!isVertical || !nextChapter || loadingNextChapter) return;
    if (appendedIdsRef.current.has(nextChapter.id)) return;
    const totalPages = effectivePages.length;
    if (totalPages === 0 || currentPage < totalPages - 3) return;
    const nc = nextChapter;
    const routeKeyAtRequest = activeRouteKey;
    appendedIdsRef.current.add(nc.id);
    setLoadingNextChapter(true);
    const loadPages = clientAdapter?.pages
      ? clientAdapter.pages(String(nc.id)).catch(error => {
          if ((isNativeApp && !clientAdapter.fallbackToServerOnNative) || clientAdapter.fallbackToServer === false) throw error;
          return customFetch<any>(`/api/chapter/${encodeURIComponent(nc.id)}/pages`, {
            headers: sourceId ? { "X-Source": sourceId } : undefined,
          });
        })
      : isNativeApp
        ? Promise.reject(new Error("No device-side page adapter is installed for this source."))
        : customFetch<any>(`/api/chapter/${encodeURIComponent(nc.id)}/pages`, {
            headers: sourceId ? { "X-Source": sourceId } : undefined,
          });
    loadPages
      .then((data: { pages: { index: number; url: string }[] }) => {
        if (activeRouteKeyRef.current !== routeKeyAtRequest) return;
        setAppendedChapters(prev => [...prev, { id: nc.id, number: nc.number, title: nc.title ?? '', pages: data.pages }]);
      })
      .catch(() => {
        if (activeRouteKeyRef.current === routeKeyAtRequest) appendedIdsRef.current.delete(nc.id);
      })
      .finally(() => {
        if (activeRouteKeyRef.current === routeKeyAtRequest) setLoadingNextChapter(false);
      });
  }, [currentPage, nextChapter, pagesData, loadingNextChapter, effectiveDirection, activeRouteKey, sourceId, clientAdapter, isNativeApp]);

  const navigateToChapter = (id: string) => {
    setLocation(readerUrl(id, mangaId || "", sourceId));
  };

  const goBack = () => {
    // Do not use browser history here: reader navigation and automatic chapter
    // loading can leave alternating reader entries (4 → 5 → 4). Always return
    // directly to the current title's chapter list.
    if (mangaId && sourceId) {
      setLocation(`/sources/${encodeURIComponent(sourceId)}/manga/${encodeURIComponent(mangaId)}`);
    } else if (mangaId) {
      setLocation(`/manga/${encodeURIComponent(mangaId)}`);
    } else {
      setLocation("/sources");
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { goBack(); return; }
    const isPaginated = effectiveDirection === 'ltr' || effectiveDirection === 'rtl';
    if (e.key === 'ArrowRight') {
      if (isPaginated && containerRef.current) {
        containerRef.current.scrollBy({ left: effectiveDirection === 'ltr' ? containerRef.current.clientWidth : -containerRef.current.clientWidth, behavior: 'smooth' });
      }
    } else if (e.key === 'ArrowLeft') {
      if (isPaginated && containerRef.current) {
        containerRef.current.scrollBy({ left: effectiveDirection === 'ltr' ? -containerRef.current.clientWidth : containerRef.current.clientWidth, behavior: 'smooth' });
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [effectiveDirection]);

  // Detect direct video files and the remaining AllManga/AnimeGG stream routes.
  const isVideoUrl = (url: string) =>
    /\.(mp4|webm|ogg|mov|mkv|avi)(\?|$|&)/i.test(url) ||
    /\.(mp4|webm|mov|mkv|avi)$/i.test(decodeURIComponent(url)) ||
    /\/api\/allmanga\/video(\?|$)/i.test(url) ||
    /animegg\.org\/embed\//i.test(url) || /\/api\/animegg\/embed(?:\?|$)/i.test(url);

  const textPage = effectivePages.find((page) => Boolean(page.text));
  const safeNovelText = useMemo(() => {
    if (!textPage?.text) return "";
    const document = new DOMParser().parseFromString(textPage.text, "text/html");
    document.querySelectorAll("script, style, iframe, object, embed, svg, math, form").forEach(element => element.remove());
    return (document.body.innerText || document.body.textContent || "").trim();
  }, [textPage?.text]);
  useEffect(() => {
    novelEndHandledRef.current = false;
    novelScrollRestoredRef.current = false;
  }, [chapterId]);

  // Text chapters start at the top as well; saved scroll offsets must not
  // carry a previous chapter's bottom position into a newly opened chapter.
  useEffect(() => {
    if (!textPage?.text || novelScrollRestoredRef.current) return;
    const restore = () => {
      window.scrollTo({ top: 0, behavior: "auto" });
      novelScrollRestoredRef.current = true;
    };
    requestAnimationFrame(restore);
  }, [textPage?.text]);

  useEffect(() => {
    if (!textPage?.text || !mangaId || !effectiveMangaData || !effectiveChapterData.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveNovelPosition = () => {
      const chapter = effectiveChapterData.find(c => sameChapterId(c.id, chapterId));
      if (!chapter) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        storeActions.recordProgress({
          mangaId, chapterId: chapter.id, chapterNumber: chapter.number,
          chapterTitle: chapter.title, mangaTitle: effectiveMangaData.title,
          mangaThumbnail: effectiveMangaData.thumbnail, totalPages: 1,
          lastPageRead: 0, scrollOffset: Math.max(0, Math.round(window.scrollY)),
          isRead: currentProgress?.isRead ?? false,
        });
      }, 350);
    };
    window.addEventListener("scroll", saveNovelPosition, { passive: true });
    return () => {
      window.removeEventListener("scroll", saveNovelPosition);
      clearTimeout(timer);
    };
  }, [textPage?.text, mangaId, effectiveMangaData, effectiveChapterData, chapterId, currentProgress?.isRead]);

  useEffect(() => {
    if (!textPage?.text || !nextChapter || novelEndHandledRef.current) return;
    const onNovelScroll = () => {
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 56;
      if (!atEnd || novelEndHandledRef.current) return;
      novelEndHandledRef.current = true;
      setLocation(readerUrl(nextChapter.id, mangaId || "", sourceId));
    };
    window.addEventListener("scroll", onNovelScroll, { passive: true });
    return () => window.removeEventListener("scroll", onNovelScroll);
  }, [textPage?.text, nextChapter?.id, mangaId, sourceId, setLocation]);

  if (effectiveLoading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white/50">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Loading chapter pages...</p>
      </div>
    );
  }

  if (effectiveError) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-white text-lg font-bold">Couldn't load this chapter</h2>
        <p className="text-white/60 text-sm max-w-md">
          {effectiveError instanceof Error ? effectiveError.message : "The source returned an error while loading the chapter pages."}
        </p>
        <Button variant="outline" className="mt-2 text-white border-white/30 hover:bg-white/10" onClick={goBack}>
          Go Back
        </Button>
      </div>
    );
  }

  if (effectivePages.length === 0) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-4xl">📭</div>
        <h2 className="text-white text-lg font-bold">Chapter unavailable</h2>
        <p className="text-white/60 text-sm max-w-xs">
          {isNativeApp && !clientAdapter?.pages
            ? "This source does not have a device-side page adapter yet; the mobile app does not send scraping requests through the server."
            : "This chapter's images couldn't be loaded. The site may require JavaScript to display pages, which our reader doesn't support yet."}
        </p>
        <Button variant="outline" className="mt-2 text-white border-white/30 hover:bg-white/10" onClick={goBack}>
          Go Back
        </Button>
      </div>
    );
  }

  // ── Video content → render dedicated cinematic player ─────────────────────
  // When ANY page is a video URL (for example, AllManga anime episodes),
  // bypass the manga strip entirely and show the full-screen video player.
  if (effectivePages.length > 0 && effectivePages.some(p => isVideoUrl(p.url))) {
    const videoUrl = effectivePages[0].url;
    const videoTracks = effectivePages[0].videoTracks;
    const mangaTitle = effectiveMangaData?.title ?? "Video";
    const chObj = effectiveChapterData.find(c => String(c.id) === chapterId);
    const chapterTitle = chObj
      ? `Ch. ${chObj.number}${chObj.title ? ` — ${chObj.title}` : ""}`
      : undefined;
    return (
      <VideoPlayer
        url={videoUrl}
        tracks={videoTracks}
        title={mangaTitle}
        subtitle={chapterTitle}
        onBack={goBack}
      />
    );
  }

  // ── Text content → render dedicated novel reader ────────────────────────
  if (textPage?.text) {
    const novelTitle = effectiveMangaData?.title ?? "Novel";
    const chapterTitle = textPage.title || effectiveChapterData.find(c => String(c.id) === chapterId)?.title || "Chapter";
    const novelDark = novelBackground === "dark";
    return (
      <div
        className={`min-h-[100dvh] ${novelDark ? "bg-[#171717] text-[#e7e5e4]" : "bg-[#f4f1ea] text-[#27231f]"}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, [role=dialog], input, select")) return;
          void toggleReaderControls();
        }}
      >
        <div
          className={`fixed inset-x-0 top-0 z-20 border-b backdrop-blur px-3 py-3 sm:px-6 transition-[transform,opacity] duration-300 ${novelDark ? "border-white/10 bg-[#171717]/95" : "border-black/10 bg-[#f4f1ea]/95"}`}
          style={{ transform: showControls ? "translateY(0)" : "translateY(-110%)", opacity: showControls ? 1 : 0, pointerEvents: showControls ? "auto" : "none" }}
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <Button variant="ghost" size="icon" className={novelDark ? "text-white/80 hover:text-white" : ""} onClick={goBack} aria-label="Go back"><ChevronLeft className="h-5 w-5" /></Button>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-xs ${novelDark ? "text-white/50" : "text-black/50"}`}>{novelTitle}</div>
              <div className="truncate text-sm font-semibold">{chapterTitle}</div>
            </div>
            <Button variant="ghost" size="icon" className={novelDark ? "text-white/80 hover:text-white" : ""} disabled={!prevChapter} onClick={() => prevChapter && navigateToChapter(prevChapter.id)} aria-label="Previous chapter"><ChevronLeft className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" className={novelDark ? "text-white/80 hover:text-white" : ""} disabled={!nextChapter} onClick={() => nextChapter && navigateToChapter(nextChapter.id)} aria-label="Next chapter"><ChevronRight className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" className="text-white/70 hover:text-white" onClick={(e) => { e.stopPropagation(); void toggleReaderControls(); }} title={showControls ? "Hide controls and enter fullscreen" : "Show controls"} aria-label={showControls ? "Hide controls and enter fullscreen" : "Show controls"}>
              {showControls ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className={novelDark ? "text-white/80 hover:text-white" : ""} aria-label="Novel reader settings"><Settings className="h-5 w-5" /></Button>
              </SheetTrigger>
              <SheetContent className="w-[300px] sm:w-[400px]" onClick={(e) => e.stopPropagation()}>
                <SheetHeader><SheetTitle>Novel reader settings</SheetTitle></SheetHeader>
                <div className="mt-6 space-y-3">
                  <Label>Page theme</Label>
                  <RadioGroup value={novelBackground} onValueChange={(value) => setNovelBackground(value as "dark" | "light")}>
                    <div className="flex items-center gap-2"><RadioGroupItem value="dark" id="novel-theme-dark" /><Label htmlFor="novel-theme-dark">Dark</Label></div>
                    <div className="flex items-center gap-2"><RadioGroupItem value="light" id="novel-theme-light" /><Label htmlFor="novel-theme-light">Light</Label></div>
                  </RadioGroup>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        <article className={`mx-auto max-w-3xl px-5 pt-24 pb-8 sm:px-8 sm:pt-28 sm:pb-12 whitespace-pre-wrap leading-8 ${novelDark ? "text-[#e7e5e4]" : "text-[#27231f]"}`}>
          {safeNovelText}
        </article>
      </div>
    );
  }

  const bgClass = readerSettings.background === 'paper' ? 'bg-[#f4f1ea]' : readerSettings.background === 'black' ? 'bg-black' : 'bg-[#1a1a1a]';
  const textClass = readerSettings.background === 'paper' ? 'text-black' : 'text-white';
  const fitClass = readerSettings.fit === 'width' ? 'w-full h-auto' : readerSettings.fit === 'height' ? 'h-[100dvh] w-auto mx-auto' : 'w-auto h-auto mx-auto';

  const handlePageClick = (e: React.MouseEvent) => {
    const x = e.clientX;
    const w = window.innerWidth;
    if (effectiveDirection === 'ltr' || effectiveDirection === 'rtl') {
      const goNext = effectiveDirection === 'ltr' ? x > w / 2 : x < w / 2;
      if (containerRef.current) {
        containerRef.current.scrollBy({ left: goNext ? containerRef.current.clientWidth * (effectiveDirection === 'rtl' ? -1 : 1) : -containerRef.current.clientWidth * (effectiveDirection === 'rtl' ? -1 : 1), behavior: 'smooth' });
      }
    } else {
      void toggleReaderControls();
    }
  };

  const currChapterObj = effectiveChapterData.find(c => String(c.id) === chapterId);
  const activeReaderChapter = useMemo(() => {
    if (effectiveDirection !== "webtoon" && effectiveDirection !== "vertical") return currChapterObj;
    let offset = effectivePages.length;
    for (const chapter of appendedChapters) {
      const end = offset + (chapter.pages?.length ?? 0);
      if (currentPage < end) return chapter;
      offset = end;
    }
    return currChapterObj;
  }, [effectiveDirection, effectivePages.length, appendedChapters, currentPage, currChapterObj]);
  const appendedPageCount = effectiveDirection === "webtoon" || effectiveDirection === "vertical"
    ? appendedChapters.reduce((total, chapter) => total + (chapter.pages?.length ?? 0), 0)
    : 0;
  const readerPageCount = effectivePages.length + appendedPageCount;
  const activeChapterId = String(activeReaderChapter?.id ?? chapterId);
  const chapterFavoriteKey = `chapter:${sourceId ?? ""}:${mangaId ?? ""}:${activeChapterId}`;
  const isChapterFavorite = !!chapterFavorites[chapterFavoriteKey];

  const jumpToPage = (targetPage: number) => {
    if (readerPageCount <= 0) return;
    const page = Math.max(0, Math.min(Math.round(targetPage), readerPageCount - 1));
    setCurrentPage(page);
    if (effectiveDirection === "ltr" || effectiveDirection === "rtl") {
      const container = containerRef.current;
      if (container) {
        container.scrollTo({
          left: (effectiveDirection === "ltr" ? page : -page) * container.clientWidth,
          behavior: "auto",
        });
      }
      return;
    }
    document.getElementById(`page-${page}`)?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  return (
    <div className={`min-h-[100dvh] ${bgClass} relative select-none`} onClick={handlePageClick}>
      {/* Top Bar */}
      <div
        className={`reader-top-bar fixed inset-x-0 top-0 z-50 bg-black/90 backdrop-blur transition-[transform,opacity] duration-300 ${showControls ? "" : "reader-controls-hidden-standalone"}`}
        style={{
          // Include the device safe area in the toolbar itself. The previous
          // implementation rendered a separate safe-area block and then also
          // translated by the safe-area height, which left a visible gap when
          // the PWA was launched from the homescreen.
          paddingTop: "env(safe-area-inset-top, 0px)",
          transform: showControls
            ? "translateY(0)"
            : "translateY(-100%)",
        }}
      >
        <div className="border-b border-white/10 text-white flex items-center justify-between p-2 sm:px-4 h-14">
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <Button variant="ghost" size="icon" className="text-white/70 hover:text-white shrink-0" onClick={(e) => { e.stopPropagation(); goBack(); }}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex flex-col justify-center">
              <div className="text-xs text-white/50 truncate leading-none mb-1">{effectiveMangaData?.title || "Loading..."}</div>
              <div className="text-sm font-semibold truncate leading-none">
                {isRule34
                  ? "Artwork"
                  : `Ch. ${currChapterObj?.number} ${currChapterObj?.title ? `- ${currChapterObj.title}` : ""}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Button variant="ghost" size="icon" disabled={!prevChapter} onClick={(e) => { e.stopPropagation(); if (prevChapter) navigateToChapter(prevChapter.id); }} className="text-white/70 hover:text-white" title="Previous Chapter">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" disabled={!nextChapter} onClick={(e) => { e.stopPropagation(); if (nextChapter) navigateToChapter(nextChapter.id); }} className="text-white/70 hover:text-white" title="Next Chapter">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <ReaderTranslationControl
              pageIndex={currentPage}
              chapterId={chapterId}
              pages={translationPages}
              visiblePageIndices={visiblePageIndices}
              sourceId={sourceId}
              enabled={aiTranslationEnabled}
              targetLanguage={translationTargetLanguage}
              onTargetLanguageChange={setTranslationTargetLanguage}
              disabled={!translationPages[currentPage] || !translationPages[currentPage].loaded || translationPages[currentPage].failed}
              selectionRequest={selectionRequest}
              selectionActive={regionSelecting}
              onRequestRegionSelection={requestRegionSelection}
              onCancelRegionSelection={cancelRegionSelection}
              onSelectionHandled={handleSelectionHandled}
              onTranslated={handlePageTranslated}
              onClear={clearPageTranslation}
              onClearAll={clearAllPageTranslations}
            />
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="text-white/70 hover:text-white ml-1" onClick={e => e.stopPropagation()}>
                  <Settings className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="w-[300px] sm:w-[400px] max-h-[100dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <SheetHeader><SheetTitle>Reader Settings</SheetTitle></SheetHeader>
                <div className="py-6 space-y-6">
                  <div className="flex items-start gap-3 rounded-lg border p-3">
                    <Switch
                      id="reader-ai-translation"
                      checked={aiTranslationEnabled}
                      onCheckedChange={setAiTranslationEnabled}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="reader-ai-translation">AI page translation</Label>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Cached translations load for pages you view. In the translation settings you can translate a whole page or drag a box around a single bubble. New AI work happens only when you start a translation.
                      </p>
                    </div>
                  </div>
                  {aiTranslationEnabled && (
                    <div className="space-y-2">
                      <Label>Translate to</Label>
                      <TranslationLanguagePicker
                        value={translationTargetLanguage}
                        onChange={setTranslationTargetLanguage}
                        options={TARGET_LANGUAGE_OPTIONS}
                        label="Target language"
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Saved on this device. Changing languages keeps each language’s cached translations.
                      </p>
                    </div>
                  )}
                  <div className="space-y-3">
                    <Label>Reading Direction</Label>
                    <Select
                      value={effectiveDirection}
                      onValueChange={(v: any) => {
                        if (sourceId === 'en.rule34') {
                          storeActions.setSourceReaderDirection('en.rule34', v);
                        } else {
                          storeActions.setReader({ direction: v });
                        }
                      }}
                    >
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
          effectiveDirection === 'ltr' || effectiveDirection === 'rtl'
          ? 'h-[100dvh] flex overflow-x-auto snap-x snap-mandatory hide-scrollbar flex-row'
          : 'flex flex-col items-center max-w-3xl mx-auto'
        } ${effectiveDirection === 'rtl' ? 'flex-row-reverse' : ''}`}>
        {effectivePages.map((page, idx) => {
          const isVerticalLike = effectiveDirection === 'webtoon' || effectiveDirection === 'vertical';
          const isLoaded = !!loadedImgs[idx];
          const isWebtoon = effectiveDirection === 'webtoon';
          const isPaged = effectiveDirection === 'ltr' || effectiveDirection === 'rtl';
          const hasTextPage = typeof page.text === 'string' && page.text.length > 0;

          // ── Windowed rendering for vertical/webtoon modes ──────────────
          // Only keep images in the DOM within ±12 pages of where the user is.
          // Pages outside this window are replaced with a same-height placeholder
          // so scroll position stays correct. Paginated (LTR/RTL) keeps all pages
          // because each page is a snap point that needs to exist in the DOM.
          const WINDOW = 12;
          const inWindow = isPaged || Math.abs(idx - currentPage) <= WINDOW;

          if (!inWindow) {
            // Use stored height if we measured it, else estimate from screen width
            const storedH = pageHeightsRef.current[idx];
            const estH = storedH || Math.round(window.innerWidth * (window.innerWidth < 640 ? 1.45 : 1.3));
            return (
              <div
                key={page.index}
                id={`page-${idx}`}
                data-reader-page-index={idx}
                className={`reader-page w-full flex-shrink-0 ${isVerticalLike && !isWebtoon ? 'mb-8' : ''}`}
                style={{ height: estH, minHeight: estH, background: 'transparent', overflowAnchor: 'auto' }}
              />
            );
          }

          // Determine load strategy: eager for ±5 pages around current, lazy otherwise
          const distToPage = Math.abs(idx - currentPage);
          const loadStrategy: 'eager' | 'lazy' = isPaged
            ? (idx < 3 ? 'eager' : 'lazy')
            : (distToPage <= 5 ? 'eager' : 'lazy');


          return (
            <div
              key={page.index}
              id={`page-${idx}`}
              data-reader-page-index={idx}
              className={`reader-page relative flex-shrink-0 ${
                isPaged
                ? isRule34
                  ? 'flex items-center justify-center bg-black w-auto min-w-[100vw] h-[100dvh] snap-center snap-always'
                  : 'flex items-center justify-center bg-black w-[100vw] h-[100dvh] snap-center snap-always'
                : isWebtoon ? 'w-full' : 'flex items-center justify-center bg-black w-full'
              } ${effectiveDirection === 'vertical' ? 'mb-8' : ''}`}
              style={!hasTextPage && !isPaged && (!isLoaded || !!failedImgs[idx]) ? {
                minHeight: pageHeightsRef.current[idx] ?? 'min(145vw, 1100px)',
                overflowAnchor: 'auto',
              } : undefined}>
              {effectiveDirection === 'vertical' && (
                <div className="absolute -bottom-6 text-xs text-muted-foreground">{idx + 1}</div>
              )}
              {/* Webtoon / vertical: keep image in normal flow to avoid layout shift.
                  Loader overlays the image while it loads — no opacity-0+absolute swap. */}
              {hasTextPage ? (
                <article className={`w-full max-w-3xl mx-auto px-6 py-8 text-left text-foreground bg-background ${isPaged ? 'h-[calc(100dvh-3.5rem)] overflow-y-auto' : ''}`}>
                  {page.title && <h2 className="text-lg font-semibold mb-6">{page.title}</h2>}
                  <div className="whitespace-pre-wrap leading-8">{page.text}</div>
                </article>
              ) : isWebtoon ? (
                <div
                  className="relative w-full"
                  style={{
                    minHeight: !isLoaded || failedImgs[idx]
                      ? (pageHeightsRef.current[idx] ?? 'min(145vw, 1100px)')
                      : undefined,
                    overflowAnchor: 'auto',
                  }}
                >
                  {failedImgs[idx] ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white/60 text-sm px-4 text-center">
                      <span className="text-2xl">⚠️</span>
                      <span>Page {idx + 1} could not be loaded</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-white/30 text-white hover:bg-white/10"
                        onClick={(event) => { event.stopPropagation(); retryPage(idx); }}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry page
                      </Button>
                    </div>
                  ) : (
                    <img
                      src={resolveReaderMediaUrl(imageUrlWithRetry(page.url, idx), sourceId)}
                      alt={`Page ${page.index}`}
                      loading={loadStrategy}
                      decoding="async"
                      onLoad={(e) => handlePageImageLoad(idx, e)}
                      onError={() => {
                        setFailedImgs((p) => ({ ...p, [idx]: true }));
                        setLoadedImgs((p) => ({ ...p, [idx]: true }));
                      }}
                      style={{ display: 'block', width: '100%', height: 'auto', margin: 0, padding: 0, verticalAlign: 'top', lineHeight: 0 }}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  {!isLoaded && !failedImgs[idx] && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white/40 pointer-events-none">
                      <Loader2 className="h-10 w-10 animate-spin" />
                      <div className="mt-3 text-xs tabular-nums">{idx + 1} / {effectivePages.length}</div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {!isLoaded && (
                    <div className="flex flex-col items-center justify-center min-h-[40vw] w-full bg-black text-white/40 pointer-events-none">
                      <Loader2 className="h-10 w-10 animate-spin" />
                      <div className="mt-3 text-xs tabular-nums">{idx + 1} / {effectivePages.length}</div>
                    </div>
                  )}
                  {failedImgs[idx] ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 w-full bg-black text-white/60 text-sm px-4 text-center">
                      <span className="text-2xl">⚠️</span>
                      <span>Page {idx + 1} could not be loaded</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-white/30 text-white hover:bg-white/10"
                        onClick={(event) => { event.stopPropagation(); retryPage(idx); }}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry page
                      </Button>
                    </div>
                  ) : (
                    <img
                      src={resolveReaderMediaUrl(imageUrlWithRetry(page.url, idx), sourceId)}
                      alt={`Page ${page.index}`}
                      className={`transition-opacity duration-200 ${isLoaded ? 'opacity-100' : 'opacity-0 absolute'}`}
                      loading={loadStrategy}
                      decoding="async"
                      onLoad={(e) => handlePageImageLoad(idx, e)}
                      onError={() => {
                        setFailedImgs((p) => ({ ...p, [idx]: true }));
                        setLoadedImgs((p) => ({ ...p, [idx]: true }));
                      }}
                       style={{
                         display: 'block',
                         maxWidth: isPaged ? '100vw' : '100%',
                         maxHeight: isPaged ? 'calc(100dvh - 3.5rem)' : undefined,
                         width: isPaged ? 'auto' : undefined,
                         height: isPaged ? 'auto' : undefined,
                         objectFit: 'contain',
                       }}
                       referrerPolicy="no-referrer"
                    />
                  )}
                </>
              )}
              {!hasTextPage && <PageTranslationOverlay pageIndex={idx} regions={pageTranslations[idx] ?? []} />}
              {!hasTextPage && <ReaderRegionSelector
                pageIndex={idx}
                active={regionSelecting && idx === regionTargetPage}
                onSelected={handleRegionSelected}
                onCancel={cancelRegionSelection}
              />}
            </div>
          );
        })}

        {/* Continuous reading: appended chapters */}
        {(effectiveDirection === 'webtoon' || effectiveDirection === 'vertical') && appendedChapters.map((ch, chapterOffsetIndex) => {
          const globalChapterOffset = effectivePages.length + appendedChapters
            .slice(0, chapterOffsetIndex)
            .reduce((total, previousChapter) => total + previousChapter.pages.length, 0);
          return (
          <div key={ch.id} className="w-full">
            <div className="flex items-center gap-4 px-4 py-6 bg-black/80 border-y border-white/10">
              <div className="flex-1 h-px bg-white/20" />
              <div className="text-center">
                <div className="text-white/50 text-xs mb-1">Next Chapter</div>
                <div className="text-white font-semibold text-sm">Ch. {ch.number}{ch.title ? ` — ${ch.title}` : ''}</div>
              </div>
              <div className="flex-1 h-px bg-white/20" />
            </div>
            {ch.pages.map((page, pageIndex) => {
              const isWebtoon = effectiveDirection === 'webtoon';
              const globalPageIndex = globalChapterOffset + pageIndex;
              return (
                <div
                  key={`${ch.id}:${page.index}`}
                  id={`page-${globalPageIndex}`}
                  data-reader-page-index={globalPageIndex}
                  className={`reader-page relative flex-shrink-0 ${
                    isWebtoon ? 'w-full' : 'flex items-center justify-center bg-black w-full mb-8'
                  }`}>
                  <img
                    src={resolveReaderMediaUrl(page.url, sourceId)}
                    alt={`Ch${ch.number} Page ${page.index}`}
                    loading="lazy"
                    decoding="async"
                    onLoad={event => handlePageImageLoad(globalPageIndex, event)}
                    onError={() => {
                      setFailedImgs(previous => ({ ...previous, [globalPageIndex]: true }));
                      setLoadedImgs(previous => ({ ...previous, [globalPageIndex]: true }));
                    }}
                    style={
                      isWebtoon
                        ? { display: 'block', width: '100%', height: 'auto', margin: 0, padding: 0, verticalAlign: 'top', lineHeight: 0 }
                        : { display: 'block', maxWidth: '100%', objectFit: 'contain' }
                    }
                    referrerPolicy="no-referrer"
                  />
                  <PageTranslationOverlay pageIndex={globalPageIndex} regions={pageTranslations[globalPageIndex] ?? []} />
                  <ReaderRegionSelector
                    pageIndex={globalPageIndex}
                    active={regionSelecting && globalPageIndex === regionTargetPage}
                    onSelected={handleRegionSelected}
                    onCancel={cancelRegionSelection}
                  />
                </div>
              );
            })}
          </div>
          );
        })}

        {(effectiveDirection === 'webtoon' || effectiveDirection === 'vertical') && loadingNextChapter && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-white/50">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Loading next chapter…</span>
          </div>
        )}

        {(effectiveDirection === 'webtoon' || effectiveDirection === 'vertical') && !nextChapter && appendedChapters.length === 0 && (
          <div className="py-16 flex flex-col items-center gap-4 text-white/40">
            <div className="text-sm">You've reached the end</div>
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); goBack(); }}>
              Back to Manga
            </Button>
          </div>
        )}
      </div>

      <div
        className={`fixed left-1/2 z-40 w-[min(94vw,720px)] -translate-x-1/2 transition-[opacity,transform] duration-300 ${showControls ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        aria-hidden={!showControls}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-800/95 px-3 py-2 text-white shadow-xl backdrop-blur sm:gap-4 sm:px-5">
          {readerSettings.showPageNumber && (
            <>
              <span className="w-6 shrink-0 text-center text-sm tabular-nums text-white/90">{readerPageCount ? Math.min(currentPage + 1, readerPageCount) : 0}</span>
              <input
                type="range"
                min={0}
                max={Math.max(0, readerPageCount - 1)}
                step={1}
                value={readerPageCount ? Math.min(currentPage, readerPageCount - 1) : 0}
                disabled={readerPageCount <= 1}
                aria-label="Page scrubber"
                aria-valuetext={readerPageCount ? `Page ${Math.min(currentPage + 1, readerPageCount)} of ${readerPageCount}` : "No pages loaded"}
                className="reader-page-scrubber min-w-0 flex-1"
                style={{ "--reader-page-step": `calc(100% / ${Math.max(readerPageCount - 1, 1)})` } as CSSProperties}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => jumpToPage(Number(event.currentTarget.value))}
              />
              <span className="w-6 shrink-0 text-center text-sm tabular-nums text-white/90">{readerPageCount}</span>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`h-9 w-9 shrink-0 text-white/75 hover:text-white ${isChapterFavorite ? "text-sky-300" : ""}`}
            title={isChapterFavorite ? "Remove chapter bookmark" : "Bookmark this chapter"}
            aria-label={isChapterFavorite ? "Remove chapter bookmark" : "Bookmark this chapter"}
            aria-pressed={isChapterFavorite}
            onClick={() => storeActions.toggleChapterFavorite(chapterFavoriteKey)}
          >
            {isChapterFavorite ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-white/75 hover:text-white"
            title="Chapter comments"
            aria-label="Chapter comments"
            onClick={() => setCommentsOpen(true)}
          >
            <MessageCircle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <ReaderCommentsSheet
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        onSignIn={() => { setCommentsOpen(false); setLocation("/login"); }}
        mangaTitle={String(effectiveMangaData?.title ?? "")}
        mangaAltTitles={Array.isArray((effectiveMangaData as any)?.altTitles) ? (effectiveMangaData as any).altTitles : []}
        chapterNumber={activeReaderChapter?.number ?? null}
        chapterTitle={String(activeReaderChapter?.title ?? "")}
        sourceId={sourceId}
        chapterId={activeChapterId}
        offline={isOfflineMode}
      />
    </div>
  );
}
