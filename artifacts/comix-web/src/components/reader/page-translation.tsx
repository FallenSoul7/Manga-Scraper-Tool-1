import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Languages, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TranslationLanguagePicker } from "@/components/reader/translation-language-picker";
import { apiUrl } from "@/lib/api-url";
import { mediaImage } from "@/lib/utils";
import { offlineDb } from "@/lib/offline-db";
import { getSharedTranslation, getTranslationCacheKey, TRANSLATION_REVISION, type OfflineTranslationRecord, type TranslationRegion } from "@/lib/translation-cache";
import { getSavedTranslationSourceLanguage, saveTranslationSourceLanguage, SOURCE_LANGUAGE_OPTIONS, TARGET_LANGUAGE_OPTIONS } from "@/lib/translation-languages";

export type { TranslationRegion } from "@/lib/translation-cache";

interface TranslationApiResponse {
  regions?: TranslationRegion[];
  provider?: string;
  cacheKey?: string;
  imageSha256?: string;
  cacheHit?: boolean;
  error?: string;
}

export interface ReaderTranslationPage {
  url?: string;
  loaded: boolean;
  failed: boolean;
  chapterId?: string;
  pageIndex?: number;
}

function uniqueImageCandidates(image: HTMLImageElement, pageUrl: string, sourceId?: string | null): string[] {
  const values = [mediaImage(pageUrl, sourceId ?? undefined), image.currentSrc, image.src];
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

async function readPageImage(image: HTMLImageElement, pageUrl: string, sourceId?: string | null): Promise<Blob> {
  let lastError: unknown;
  let lastHttpStatus: number | null = null;
  let networkOrCorsBlocked = false;
  for (const candidate of uniqueImageCandidates(image, pageUrl, sourceId)) {
    try {
      const absoluteUrl = new URL(candidate, window.location.href);
      const sameOrigin = absoluteUrl.origin === window.location.origin;
      const response = await fetch(absoluteUrl.toString(), {
        mode: "cors",
        credentials: sameOrigin ? "same-origin" : "omit",
        cache: "force-cache",
      });
      if (!response.ok) {
        lastHttpStatus = response.status;
        throw new Error(`Image request failed (${response.status})`);
      }
      const blob = await response.blob();
      const contentType = blob.type.split(";")[0].trim().toLowerCase();
      if (!blob.size || (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream")) {
        throw new Error("The source response was not image data.");
      }
      return blob;
    } catch (error) {
      lastError = error;
      if (error instanceof TypeError) networkOrCorsBlocked = true;
    }
  }
  if (networkOrCorsBlocked) {
    throw new Error("The page is visible, but the browser could not read its image bytes through normal CORS or an approved ComiHub image route. Some sources block pixel access; ComiHub will not bypass those restrictions.");
  }
  if (lastHttpStatus !== null) throw new Error(`The page image or its approved ComiHub route returned HTTP ${lastHttpStatus}. Retry the page or try another supported source.`);
  if (lastError instanceof Error) throw lastError;
  throw new Error("The page image could not be read for translation. Retry the page or try another source.");
}

async function loadDrawable(blob: Blob): Promise<{ drawable: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { drawable: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // Some browsers render formats which their createImageBitmap decoder does not support.
      // Fall back to the browser's regular <img> decoder using the same fetched bytes.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The page image could not be decoded."));
      element.src = objectUrl;
    });
    return { drawable: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The page image could not be compressed.")), "image/webp", quality);
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("The page image could not be prepared."));
    reader.onerror = () => reject(new Error("The page image could not be prepared."));
    reader.readAsDataURL(blob);
  });
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function preparePageImage(image: HTMLImageElement, pageUrl: string, sourceId?: string | null): Promise<{ imageDataUrl: string; imageSha256: string }> {
  const sourceBlob = await readPageImage(image, pageUrl, sourceId);
  const drawable = await loadDrawable(sourceBlob);
  try {
    if (!drawable.width || !drawable.height) throw new Error("The page image has no readable dimensions.");
    const maxDimension = 1800;
    const maxPixels = 1_800_000;
    let scale = Math.min(1, maxDimension / Math.max(drawable.width, drawable.height), Math.sqrt(maxPixels / (drawable.width * drawable.height)));
    let quality = 0.82;
    let compressed: Blob | null = null;

    // Preserve the full page while keeping the request body under Vercel/Express limits.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(drawable.width * scale));
      canvas.height = Math.max(1, Math.round(drawable.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Page-image processing is not supported in this browser.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(drawable.drawable, 0, 0, canvas.width, canvas.height);
      compressed = await canvasBlob(canvas, quality);
      if (compressed.size <= 1_750_000) break;
      scale *= 0.82;
      quality = Math.max(0.48, quality - 0.07);
    }
    if (!compressed || compressed.size > 1_750_000) {
      throw new Error("This page image is too large to send safely. Try a smaller image.");
    }
    const digest = globalThis.crypto?.subtle
      ? bytesToHex(await crypto.subtle.digest("SHA-256", await compressed.arrayBuffer()))
      : "";
    return { imageDataUrl: await blobToDataUrl(compressed), imageSha256: digest };
  } finally {
    drawable.dispose();
  }
}

interface ReaderTranslationControlProps {
  pageIndex: number;
  chapterId: string;
  pages: ReaderTranslationPage[];
  visiblePageIndices: number[];
  sourceId?: string | null;
  enabled: boolean;
  targetLanguage: string;
  onTargetLanguageChange: (language: string) => void;
  disabled?: boolean;
  onTranslated: (pageIndex: number, regions: TranslationRegion[]) => void;
  onClear: (pageIndex: number) => void;
  onClearAll: () => void;
}

export function ReaderTranslationControl({
  pageIndex,
  chapterId,
  pages,
  visiblePageIndices,
  sourceId,
  enabled,
  targetLanguage,
  onTargetLanguageChange,
  disabled = false,
  onTranslated,
  onClear,
  onClearAll,
}: ReaderTranslationControlProps) {
  const [sourceLanguage, setSourceLanguage] = useState(getSavedTranslationSourceLanguage);
  const [providerMode, setProviderMode] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const pendingPagesRef = useRef<Set<string>>(new Set());
  const cachedPageChecksRef = useRef<Set<string>>(new Set());
  const activeControllersRef = useRef<Map<string, AbortController>>(new Map());
  const generationRef = useRef(0);

  useEffect(() => {
    saveTranslationSourceLanguage(sourceLanguage);
  }, [sourceLanguage]);

  useEffect(() => {
    generationRef.current += 1;
    pendingPagesRef.current.clear();
    cachedPageChecksRef.current.clear();
    activeControllersRef.current.forEach(controller => controller.abort());
    activeControllersRef.current.clear();
    setStatus("");
    onClearAll();
  }, [chapterId, sourceId, enabled, onClearAll]);

  useEffect(() => {
    generationRef.current += 1;
    pendingPagesRef.current.clear();
    cachedPageChecksRef.current.clear();
    activeControllersRef.current.forEach(controller => controller.abort());
    activeControllersRef.current.clear();
    onClearAll();
  }, [sourceLanguage, targetLanguage, onClearAll]);

  const loadPageTranslation = useCallback(async (requestedPageIndex: number, allowProvider: boolean) => {
    if (!enabled || !chapterId) return;
    const page = pages[requestedPageIndex];
    if (!page?.url || !page.loaded || page.failed) return;
    const pageChapterId = page.chapterId || chapterId;
    const pageLocalIndex = page.pageIndex ?? requestedPageIndex;
    const attemptKey = `${pageChapterId}\n${sourceId}\n${pageLocalIndex}\n${sourceLanguage}\n${targetLanguage}`;
    if (pendingPagesRef.current.has(attemptKey)) return;
    if (!allowProvider && cachedPageChecksRef.current.has(attemptKey)) return;

    const generation = generationRef.current;
    pendingPagesRef.current.add(attemptKey);
    if (allowProvider) {
      setBusy(true);
      setStatus("Preparing the current page…");
    }
    try {
      const image = document.querySelector<HTMLImageElement>(`#page-${requestedPageIndex} img`);
      if (!image || !image.complete || !image.naturalWidth) {
        if (allowProvider) setStatus("Wait for this page image to finish loading, then try again.");
        return;
      }
      const prepared = await preparePageImage(image, page.url, sourceId);
      const cacheIdentity = prepared.imageSha256
        ? await getTranslationCacheKey({ imageSha256: prepared.imageSha256, sourceLanguage, targetLanguage })
        : null;

      if (cacheIdentity) {
        const local = await offlineDb.getTranslation(cacheIdentity.cacheKey).catch(() => null);
        if (generation !== generationRef.current) return;
        if (local?.regions?.length) {
          onTranslated(requestedPageIndex, local.regions);
          cachedPageChecksRef.current.add(attemptKey);
          if (allowProvider) setStatus(`Loaded the cached translation (${local.provider}).`);
          return;
        }

        const shared = await getSharedTranslation(cacheIdentity.cacheKey);
        if (generation !== generationRef.current) return;
        if (shared?.regions.length) {
          const record: OfflineTranslationRecord = {
            ...cacheIdentity,
            sourceId: sourceId ?? "",
            chapterId: pageChapterId,
            pageIndex: pageLocalIndex,
            regions: shared.regions,
            provider: shared.provider,
            cachedAt: Date.now(),
            expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
          };
          await offlineDb.saveTranslation(record).catch(() => undefined);
          onTranslated(requestedPageIndex, shared.regions);
          cachedPageChecksRef.current.add(attemptKey);
          if (allowProvider) setStatus(`Loaded the shared translation (${shared.provider}).`);
          return;
        }
      }

      cachedPageChecksRef.current.add(attemptKey);
      // Viewport-triggered work only reads the cache. Inference requires an explicit tap.
      if (!allowProvider || generation !== generationRef.current) return;

      setStatus("Reading and translating the current page…");
      const controller = new AbortController();
      activeControllersRef.current.set(attemptKey, controller);
      let response: Response;
      try {
        response = await fetch(apiUrl("/api/ai/translate-page"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            imageDataUrl: prepared.imageDataUrl,
            sourceLanguage,
            targetLanguage,
            providerMode,
            sourceId,
            chapterId: pageChapterId,
            pageIndex: pageLocalIndex,
          }),
        });
      } finally {
        activeControllersRef.current.delete(attemptKey);
      }
      const result = await response.json().catch(() => ({})) as TranslationApiResponse;
      if (!response.ok) throw new Error(result.error || `Translation request failed (${response.status}).`);
      if (!Array.isArray(result.regions) || result.regions.length === 0) {
        throw new Error("No readable text was detected on this page. Try a clearer page or choose its source language.");
      }
      if (generation !== generationRef.current) return;
      onTranslated(requestedPageIndex, result.regions);
      if (result.cacheKey) {
        const record: OfflineTranslationRecord = {
          cacheKey: result.cacheKey,
          imageSha256: result.imageSha256 || prepared.imageSha256,
          sourceLanguage: sourceLanguage.trim().toLowerCase() || "auto",
          targetLanguage: targetLanguage.trim().toLowerCase(),
          translationRevision: TRANSLATION_REVISION,
          sourceId: sourceId ?? "",
          chapterId: pageChapterId,
          pageIndex: pageLocalIndex,
          regions: result.regions,
          provider: result.provider || "Free AI provider route",
          cachedAt: Date.now(),
          expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
        };
        await offlineDb.saveTranslation(record).catch(() => undefined);
      }
      setStatus(`${result.cacheHit ? "Loaded cached text" : "Translated"} ${result.regions.length} text block${result.regions.length === 1 ? "" : "s"} with ${result.provider || "the free provider route"}.`);
    } catch (error) {
      if (allowProvider && generation === generationRef.current) {
        setStatus(error instanceof Error ? error.message : "Translation failed. Please try again.");
      }
    } finally {
      pendingPagesRef.current.delete(attemptKey);
      if (allowProvider && generation === generationRef.current) setBusy(false);
    }
  }, [enabled, sourceId, chapterId, pages, sourceLanguage, targetLanguage, providerMode, onTranslated]);

  useEffect(() => {
    if (!enabled) return;
    const candidates = Array.from(new Set([...visiblePageIndices, pageIndex, pageIndex + 1]))
      .filter(index => index >= 0 && index < pages.length)
      .sort((a, b) => Math.abs(a - pageIndex) - Math.abs(b - pageIndex));
    for (const candidate of candidates) void loadPageTranslation(candidate, false);
  }, [enabled, visiblePageIndices, pageIndex, pages, loadPageTranslation]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 6500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const translateCurrentPage = (event?: React.MouseEvent) => {
    event?.stopPropagation();
    void loadPageTranslation(pageIndex, true);
  };
  const currentPageNumber = pages[pageIndex]?.pageIndex ?? pageIndex;

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/70 hover:text-white"
            onClick={event => event.stopPropagation()}
            aria-label="Translation language and provider settings"
            title="Translation settings"
          >
            <Languages className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[320px] sm:w-[400px]" onClick={event => event.stopPropagation()}>
          <SheetHeader><SheetTitle>Page translation</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="translation-source-language">Source language</Label>
              <TranslationLanguagePicker
                value={sourceLanguage}
                onChange={setSourceLanguage}
                options={SOURCE_LANGUAGE_OPTIONS}
                label="Source language"
              />
            </div>
            <div className="space-y-2">
              <Label>Translate to</Label>
              <TranslationLanguagePicker
                value={targetLanguage}
                onChange={onTargetLanguageChange}
                options={TARGET_LANGUAGE_OPTIONS}
                label="Target language"
              />
              <p className="text-xs text-muted-foreground">Your choice is saved on this device. Each language keeps its own cache.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="translation-provider">Free AI route</Label>
              <Select value={providerMode} onValueChange={setProviderMode}>
                <SelectTrigger id="translation-provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Gemini, then OpenRouter Free)</SelectItem>
                  <SelectItem value="gemini">Gemini Flash-Lite</SelectItem>
                  <SelectItem value="openrouter">OpenRouter Free</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              Cached text is checked locally and then through a restricted Supabase lookup. A compressed page image is sent to the selected AI provider only after you press Translate and no cached result exists. API keys stay on the server. Gemini's free-tier terms currently say submitted data may be used to improve Google products; provider quotas apply.
            </div>
            <Button className="w-full" onClick={translateCurrentPage} disabled={!enabled || disabled || busy || !pages[pageIndex]?.url}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Languages className="mr-2 h-4 w-4" />}
              {busy ? "Translating…" : `Translate page ${currentPageNumber + 1}`}
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={() => { onClear(pageIndex); setStatus("Translation overlay cleared."); }} disabled={busy}>
              <RotateCcw className="mr-2 h-4 w-4" /> Clear this page's translation
            </Button>
            <p className="min-h-10 text-xs leading-relaxed text-muted-foreground" role="status" aria-live="polite">{status}</p>
          </div>
        </SheetContent>
      </Sheet>

      {typeof document !== "undefined" && enabled && pages[pageIndex]?.url && createPortal(
        <div className="fixed right-4 top-[58%] z-40 flex max-w-[calc(100vw-2rem)] -translate-y-1/2 flex-col items-end gap-2" onClick={event => event.stopPropagation()}>
          {status && <div className="max-w-64 rounded-lg bg-black/85 px-3 py-2 text-xs text-white shadow-lg" role="status" aria-live="polite">{status}</div>}
          <Button
            type="button"
            size="icon"
            className="h-12 w-12 rounded-full shadow-xl"
            disabled={disabled || busy}
            onClick={translateCurrentPage}
            aria-label={`Translate page ${currentPageNumber + 1}`}
            title={`Translate page ${currentPageNumber + 1}`}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Languages className="h-5 w-5" />}
          </Button>
        </div>,
        document.body,
      )}
    </>
  );
}

interface PageTranslationOverlayProps {
  pageIndex: number;
  regions: TranslationRegion[];
}

interface ImageMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function PageTranslationOverlay({ pageIndex, regions }: PageTranslationOverlayProps) {
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (regions.length === 0) {
      setMetrics(null);
      return;
    }
    const page = document.getElementById(`page-${pageIndex}`);
    const image = page?.querySelector("img");
    if (!page || !image) {
      setMetrics(null);
      return;
    }

    let animationFrame = 0;
    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const pageRect = page.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        if (!image.complete || image.naturalWidth === 0 || imageRect.width <= 0 || imageRect.height <= 0) {
          setMetrics(null);
          return;
        }
        setMetrics({
          left: imageRect.left - pageRect.left,
          top: imageRect.top - pageRect.top,
          width: imageRect.width,
          height: imageRect.height,
        });
      });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(page);
    observer?.observe(image);
    image.addEventListener("load", measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      image.removeEventListener("load", measure);
      window.removeEventListener("resize", measure);
    };
  }, [pageIndex, regions]);

  const copyText = async (regionId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(regionId);
    } catch {
      setCopied(null);
    }
  };

  if (!metrics || regions.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: metrics.left, top: metrics.top, width: metrics.width, height: metrics.height }}
      aria-label={`Translation overlay for page ${pageIndex + 1}`}
    >
      {regions.map(region => {
        const left = (region.x / 1000) * metrics.width;
        const top = (region.y / 1000) * metrics.height;
        const width = (region.width / 1000) * metrics.width;
        const height = (region.height / 1000) * metrics.height;
        const isActive = activeRegion === region.id;
        return (
          <div
            key={region.id}
            role="button"
            tabIndex={0}
            aria-label={`Translation: ${region.translatedText}. Double-click for copy options.`}
            className="pointer-events-auto absolute flex items-center justify-center overflow-visible rounded-[2px] border border-black/10 bg-white px-[2px] py-px text-center font-medium leading-tight text-black shadow-sm"
            style={{ left, top, width: Math.max(width, 8), minHeight: Math.max(height, 10), fontSize: "clamp(8px, 1.2vw, 15px)", userSelect: "text" }}
            onClick={event => event.stopPropagation()}
            onDoubleClick={event => { event.stopPropagation(); setActiveRegion(isActive ? null : region.id); setCopied(null); }}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setActiveRegion(isActive ? null : region.id); setCopied(null); }}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveRegion(isActive ? null : region.id);
                setCopied(null);
              }
            }}
          >
            <span className="max-h-full w-full overflow-hidden break-words">{region.translatedText}</span>
            {isActive && (
              <div
                className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover p-2 text-left text-popover-foreground shadow-xl"
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
              >
                <div className="max-h-20 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{region.sourceText}</div>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="inline-flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted" onClick={() => void copyText(region.id, region.sourceText)}>
                    {copied === region.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Original
                  </button>
                  <button type="button" className="inline-flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted" onClick={() => void copyText(region.id, region.translatedText)}>
                    {copied === region.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Translation
                  </button>
                  <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border hover:bg-muted" aria-label="Close text actions" onClick={() => setActiveRegion(null)}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
