import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Crop, Languages, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TranslationLanguagePicker } from "@/components/reader/translation-language-picker";
import { apiUrl } from "@/lib/api-url";
import { mediaImage } from "@/lib/utils";
import { offlineDb } from "@/lib/offline-db";
import { getSharedTranslation, getTranslationCacheKey, TRANSLATION_REVISION, type OfflineTranslationRecord, type TranslationRegion } from "@/lib/translation-cache";
import { isUsableSelection, mapRegionsToPage, mergePageRegions, quantizeSelectionValue, rectFromPoints, type NormalizedRect } from "@/lib/translation-regions";
import {
  getSavedTranslationMode,
  getSavedTranslationSourceLanguage,
  saveTranslationMode,
  saveTranslationSourceLanguage,
  SOURCE_LANGUAGE_OPTIONS,
  TARGET_LANGUAGE_OPTIONS,
  type TranslationMode,
} from "@/lib/translation-languages";

export type { TranslationRegion } from "@/lib/translation-cache";
export type { TranslationMode } from "@/lib/translation-languages";
export type { NormalizedRect } from "@/lib/translation-regions";

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

const MAX_PAYLOAD_BYTES = 1_750_000;
const MAX_DIMENSION = 1800;
const MAX_PIXELS = 1_800_000;
// Keep the language-version picker available, but pause AI page translation
// until the provider pipeline is ready again.
export const PAGE_TRANSLATION_TEMPORARILY_UNAVAILABLE = true;
/** Selection grid: quantizing the drag box keeps repeated crops closer to byte-identical. */
const SELECTION_GRID = 200;

function uniqueImageCandidates(image: HTMLImageElement, pageUrl: string, sourceId?: string | null): string[] {
  // Try the approved same-origin route first for hosts that need it, but do not
  // discard the original source URL. A transient 503 from ComiHub's backend
  // must not prevent a normal browser/CORS read when the source permits one.
  const values = [mediaImage(pageUrl, sourceId ?? undefined), pageUrl, image.currentSrc, image.src];
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

async function requestTranslation(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  const execute = () => fetch(apiUrl("/api/ai/translate-page"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  let response = await execute();
  if (response.status >= 500 && response.status <= 599 && !signal.aborted) {
    await new Promise(resolve => window.setTimeout(resolve, 900));
    if (!signal.aborted) response = await execute();
  }
  return response;
}

/**
 * The reader can display an image from the browser cache even while a second
 * request to the same source/proxy is returning 503. Prefer those already
 * decoded pixels before reporting an image-access failure. A tainted canvas
 * still fails safely and lets the caller use the normal fetch/CORS error.
 */
async function readVisibleImage(image: HTMLImageElement): Promise<Blob | null> {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  try {
    await image.decode().catch(() => {});
    const scale = Math.min(1, 3600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Force pixel-access validation before toBlob for CORS-tainted sources.
    context.getImageData(0, 0, 1, 1);
    return await canvasBlob(canvas, 0.92);
  } catch {
    return null;
  }
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compress the whole page, or only the user-selected region of it, and return a
 * data URL plus the SHA-256 of the exact bytes sent. The region variant is the
 * point of "one bubble" mode: the vision provider sees a small crop instead of
 * a full page, and the returned boxes are mapped back onto the page afterwards.
 */
async function prepareImagePayload(
  image: HTMLImageElement,
  pageUrl: string,
  sourceId: string | null | undefined,
  region?: NormalizedRect,
): Promise<{ imageDataUrl: string; imageSha256: string }> {
  let sourceBlob: Blob;
  try {
    sourceBlob = await readPageImage(image, pageUrl, sourceId);
  } catch (error) {
    const visibleBlob = await readVisibleImage(image);
    if (!visibleBlob) throw error;
    sourceBlob = visibleBlob;
  }
  const drawable = await loadDrawable(sourceBlob);
  try {
    if (!drawable.width || !drawable.height) throw new Error("The page image has no readable dimensions.");

    const startX = region ? Math.max(0, Math.min(drawable.width - 1, Math.round(region.x * drawable.width))) : 0;
    const startY = region ? Math.max(0, Math.min(drawable.height - 1, Math.round(region.y * drawable.height))) : 0;
    const requestedWidth = region ? Math.round(region.width * drawable.width) : drawable.width;
    const requestedHeight = region ? Math.round(region.height * drawable.height) : drawable.height;
    const cropWidth = Math.max(1, Math.min(requestedWidth, drawable.width - startX));
    const cropHeight = Math.max(1, Math.min(requestedHeight, drawable.height - startY));
    if (region && (cropWidth < 8 || cropHeight < 8)) throw new Error("Select a larger area so the text can be read.");

    let scale = Math.min(1, MAX_DIMENSION / Math.max(cropWidth, cropHeight), Math.sqrt(MAX_PIXELS / (cropWidth * cropHeight)));
    let quality = 0.82;
    let compressed: Blob | null = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(cropWidth * scale));
      canvas.height = Math.max(1, Math.round(cropHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Page-image processing is not supported in this browser.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(drawable.drawable, startX, startY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
      compressed = await canvasBlob(canvas, quality);
      if (compressed.size <= MAX_PAYLOAD_BYTES) break;
      scale *= 0.82;
      quality = Math.max(0.48, quality - 0.07);
    }
    if (!compressed || compressed.size > MAX_PAYLOAD_BYTES) {
      throw new Error(region ? "That area is too large to send safely. Select a smaller box." : "This page image is too large to send safely. Try a smaller image.");
    }
    const digest = globalThis.crypto?.subtle
      ? bytesToHex(await crypto.subtle.digest("SHA-256", await compressed.arrayBuffer()))
      : "";
    return { imageDataUrl: await blobToDataUrl(compressed), imageSha256: digest };
  } finally {
    drawable.dispose();
  }
}

function preparePageImage(image: HTMLImageElement, pageUrl: string, sourceId?: string | null) {
  return prepareImagePayload(image, pageUrl, sourceId);
}

/**
 * Whole-page identity memo. Region mode merges its result into the page's own
 * overlay, so the merged set is persisted under the page-image cache identity.
 * Compressing a full page is the same local cost as page mode and only happens
 * after a successful translation, so repeated bubbles reuse the memoized value.
 */
const pageIdentityMemo = new Map<string, { imageSha256: string; cacheKey: string }>();

async function getPageLevelIdentity(
  image: HTMLImageElement,
  pageUrl: string,
  sourceId: string | null | undefined,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<{ imageSha256: string; cacheKey: string } | null> {
  const imageUrl = image.currentSrc || image.src || pageUrl;
  const memoKey = `${imageUrl}\n${sourceLanguage}\n${targetLanguage}`;
  const memo = pageIdentityMemo.get(memoKey);
  if (memo) return memo;
  const prepared = await preparePageImage(image, pageUrl, sourceId);
  if (!prepared.imageSha256) return null;
  const identity = await getTranslationCacheKey({ imageSha256: prepared.imageSha256, sourceLanguage, targetLanguage });
  if (!identity) return null;
  const value = { imageSha256: prepared.imageSha256, cacheKey: identity.cacheKey };
  if (pageIdentityMemo.size > 24) pageIdentityMemo.clear();
  pageIdentityMemo.set(memoKey, value);
  return value;
}

interface ImageMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Track the rendered position of a page image inside its `.reader-page` container. */
function useImageMetrics(pageIndex: number, active: boolean): ImageMetrics | null {
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);

  useEffect(() => {
    if (!active) {
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
    // A lazy image can finish layout in the same frame that selection mode is
    // enabled. Retry briefly so the selector does not silently disappear when
    // the load event happened just before this effect subscribed.
    const retryTimer = window.setInterval(measure, 250);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearInterval(retryTimer);
      observer?.disconnect();
      image.removeEventListener("load", measure);
      window.removeEventListener("resize", measure);
    };
  }, [pageIndex, active]);

  return metrics;
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
  /** Set by the reader when the user finished dragging a box on the current page. */
  selectionRequest: { rect: NormalizedRect; pageIndex: number; existingRegions: TranslationRegion[]; nonce: number } | null;
  selectionActive: boolean;
  onRequestRegionSelection: () => void;
  onCancelRegionSelection: () => void;
  onSelectionHandled: () => void;
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
  selectionRequest,
  selectionActive,
  onRequestRegionSelection,
  onCancelRegionSelection,
  onSelectionHandled,
  onTranslated,
  onClear,
  onClearAll,
}: ReaderTranslationControlProps) {
  const [sourceLanguage, setSourceLanguage] = useState(getSavedTranslationSourceLanguage);
  const [providerMode, setProviderMode] = useState("auto");
  const [translationMode, setTranslationMode] = useState<TranslationMode>(getSavedTranslationMode);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const pendingPagesRef = useRef<Set<string>>(new Set());
  const cachedPageChecksRef = useRef<Set<string>>(new Set());
  const activeControllersRef = useRef<Map<string, AbortController>>(new Map());
  const generationRef = useRef(0);

  useEffect(() => {
    saveTranslationSourceLanguage(sourceLanguage);
  }, [sourceLanguage]);

  useEffect(() => {
    saveTranslationMode(translationMode);
  }, [translationMode]);

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
        response = await requestTranslation({ imageDataUrl: prepared.imageDataUrl, sourceLanguage, targetLanguage, providerMode, sourceId, chapterId: pageChapterId, pageIndex: pageLocalIndex }, controller.signal);
      } finally {
        activeControllersRef.current.delete(attemptKey);
      }
      const result = await response.json().catch(() => ({})) as TranslationApiResponse;
      if (!response.ok) throw new Error(result.error || (response.status >= 500 ? "The AI translation service is temporarily unavailable after two attempts. Try again or choose another free AI route." : `Translation request failed (${response.status}).`));
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

  /**
   * Region ("one bubble") translation: send only the selected crop, then map the
   * returned crop coordinates back onto the page so the overlay stays in the same
   * 0..1000 page space as whole-page results.
   */
  const translateSelectedRegion = useCallback(async (rect: NormalizedRect, targetPageIndex: number, existingRegions: TranslationRegion[]) => {
    if (!enabled || !chapterId) return;
    const page = pages[targetPageIndex];
    if (!page?.url || !page.loaded || page.failed) {
      setStatus("Wait for this page image to load before selecting an area.");
      return;
    }
    const pageChapterId = page.chapterId || chapterId;
    const pageLocalIndex = page.pageIndex ?? targetPageIndex;
    const generation = generationRef.current;
    setBusy(true);
    setStatus("Reading the selected area…");
    const attemptKey = `region\n${pageChapterId}\n${pageLocalIndex}\n${sourceLanguage}\n${targetLanguage}\n${rect.x}\n${rect.y}\n${rect.width}\n${rect.height}`;
    const controller = new AbortController();
    try {
      const image = document.querySelector<HTMLImageElement>(`#page-${targetPageIndex} img`);
      if (!image || !image.complete || !image.naturalWidth) {
        setStatus("Wait for this page image to finish loading, then try again.");
        return;
      }
      const prepared = await prepareImagePayload(image, page.url, sourceId, rect);
      activeControllersRef.current.set(attemptKey, controller);
      let response: Response;
      try {
        response = await requestTranslation({ imageDataUrl: prepared.imageDataUrl, sourceLanguage, targetLanguage, providerMode, sourceId, chapterId: pageChapterId, pageIndex: pageLocalIndex, bubbleCheck: true }, controller.signal);
      } finally {
        activeControllersRef.current.delete(attemptKey);
      }
      const result = await response.json().catch(() => ({})) as TranslationApiResponse;
      if (!response.ok) throw new Error(result.error || (response.status >= 500 ? "The AI translation service is temporarily unavailable after two attempts. Try again or choose another free AI route." : `Translation request failed (${response.status}).`));
      if (!Array.isArray(result.regions) || result.regions.length === 0) {
        throw new Error("No readable text was detected in that area. Draw a tighter box around the text.");
      }
      if (generation !== generationRef.current) return;
      const mapped = mapRegionsToPage(result.regions, rect);
      if (mapped.length === 0) throw new Error("The selected area was too small to place a translation. Select a larger box.");
      const merged = mergePageRegions(existingRegions, mapped);
      onTranslated(targetPageIndex, merged);

      // Keep the merged overlay available on this device and in the shared cache
      // under the page's own identity, so reopening the page does not re-run AI.
      const identity = await getPageLevelIdentity(image, page.url, sourceId, sourceLanguage, targetLanguage);
      if (identity) {
        const record: OfflineTranslationRecord = {
          cacheKey: identity.cacheKey,
          imageSha256: identity.imageSha256,
          sourceLanguage: sourceLanguage.trim().toLowerCase() || "auto",
          targetLanguage: targetLanguage.trim().toLowerCase(),
          translationRevision: TRANSLATION_REVISION,
          sourceId: sourceId ?? "",
          chapterId: pageChapterId,
          pageIndex: pageLocalIndex,
          regions: merged,
          provider: result.provider || "Free AI provider route",
          cachedAt: Date.now(),
          expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
        };
        await offlineDb.saveTranslation(record).catch(() => undefined);
      }
      setStatus(`Translated ${mapped.length} selected text block${mapped.length === 1 ? "" : "s"} with ${result.provider || "the free provider route"}. Draw another box to add more.`);
    } catch (error) {
      if (generation === generationRef.current) {
        setStatus(error instanceof Error ? error.message : "Translation failed. Please try again.");
      }
    } finally {
      activeControllersRef.current.delete(attemptKey);
      if (generation === generationRef.current) setBusy(false);
    }
  }, [enabled, chapterId, pages, sourceId, sourceLanguage, targetLanguage, providerMode, onTranslated]);

  const selectionNonceRef = useRef(0);
  useEffect(() => {
    if (!selectionRequest || selectionRequest.nonce === selectionNonceRef.current) return;
    selectionNonceRef.current = selectionRequest.nonce;
    const { rect, pageIndex: targetPageIndex, existingRegions } = selectionRequest;
    void translateSelectedRegion(rect, targetPageIndex, existingRegions).finally(() => onSelectionHandled());
  }, [selectionRequest, translateSelectedRegion, onSelectionHandled]);

  useEffect(() => {
    if (!enabled || PAGE_TRANSLATION_TEMPORARILY_UNAVAILABLE) return;
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
    if (PAGE_TRANSLATION_TEMPORARILY_UNAVAILABLE) {
      setStatus("Page translation is currently unavailable right now.");
      return;
    }
    void loadPageTranslation(pageIndex, true);
  };

  const startRegionSelection = (event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (PAGE_TRANSLATION_TEMPORARILY_UNAVAILABLE) {
      setStatus("Page translation is currently unavailable right now.");
      return;
    }
    setStatus("Drag a box around the bubble you want translated.");
    onRequestRegionSelection();
  };

  const primaryAction = (event?: React.MouseEvent) => {
    if (translationMode === "region") startRegionSelection(event);
    else translateCurrentPage(event);
  };

  const currentPageNumber = pages[pageIndex]?.pageIndex ?? pageIndex;
  const isRegionMode = translationMode === "region";
  const primaryDisabled = PAGE_TRANSLATION_TEMPORARILY_UNAVAILABLE || !enabled || disabled || !pages[pageIndex]?.url || (!isRegionMode && busy);
  const actionLabel = isRegionMode
    ? (selectionActive ? `Selecting on page ${currentPageNumber + 1}…` : `Select a bubble on page ${currentPageNumber + 1}`)
    : `Translate page ${currentPageNumber + 1}`;

  return (
    <>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/70 hover:text-white"
            onClick={event => event.stopPropagation()}
            disabled={primaryDisabled}
            aria-label="Translation language and provider settings"
            title={PAGE_TRANSLATION_TEMPORARILY_UNAVAILABLE ? "Page translation is currently unavailable" : "Translation settings"}
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
              <Label htmlFor="translation-mode">Translation mode</Label>
              <Select value={translationMode} onValueChange={value => setTranslationMode(value === "region" ? "region" : "page")}>
                <SelectTrigger id="translation-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">Whole page (all bubbles)</SelectItem>
                  <SelectItem value="region">One bubble (drag a box)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {isRegionMode
                  ? "Only the box you draw is sent to the AI provider, which keeps vision input small. Each result is merged into this page's overlay."
                  : "One request covers every bubble on the page and shares a single cached result."}
              </p>
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
              Cached text is checked locally and then through a restricted Supabase lookup. {isRegionMode ? "A compressed crop of the selected area" : "A compressed page image"} is sent to the selected AI provider only after you start a translation and no cached result exists. API keys stay on the server. Gemini's free-tier terms currently say submitted data may be used to improve Google products; provider quotas apply.
            </div>
            <Button
              className="w-full"
              onClick={event => { primaryAction(event); if (isRegionMode) setSheetOpen(false); }}
              disabled={primaryDisabled || (isRegionMode && selectionActive)}
            >
              {isRegionMode ? <Crop className="mr-2 h-4 w-4" /> : (busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Languages className="mr-2 h-4 w-4" />)}
              {isRegionMode ? actionLabel : (busy ? "Translating…" : actionLabel)}
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
          {selectionActive ? (
            <div className="flex flex-col items-end gap-2 rounded-lg bg-black/85 px-3 py-2 text-right text-xs text-white shadow-lg">
              <span className="max-w-56">Drag a box around the bubble you want translated.</span>
              <Button type="button" variant="outline" size="sm" className="h-7 border-white/40 bg-transparent px-2 text-xs text-white hover:bg-white/10" onClick={event => { event.stopPropagation(); onCancelRegionSelection(); }}>
                <X className="mr-1 h-3 w-3" /> Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="icon"
              className="h-12 w-12 rounded-full shadow-xl"
              disabled={primaryDisabled}
              onClick={primaryAction}
              aria-label={actionLabel}
              title={actionLabel}
            >
              {isRegionMode ? <Crop className="h-5 w-5" /> : (busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Languages className="h-5 w-5" />)}
            </Button>
          )}
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

export function PageTranslationOverlay({ pageIndex, regions }: PageTranslationOverlayProps) {
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const metrics = useImageMetrics(pageIndex, regions.length > 0);

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

interface ReaderRegionSelectorProps {
  pageIndex: number;
  active: boolean;
  onSelected: (rect: NormalizedRect) => void;
  onCancel: () => void;
}

/**
 * Drag-to-select layer for "one bubble" translation. It is rendered inside the
 * page container next to the translation overlay, so the drawn box maps exactly
 * onto the displayed page image regardless of zoom or reading direction.
 */
export function ReaderRegionSelector({ pageIndex, active, onSelected, onCancel }: ReaderRegionSelectorProps) {
  const metrics = useImageMetrics(pageIndex, active);
  const [rect, setRect] = useState<NormalizedRect | null>(null);
  const [pendingRect, setPendingRect] = useState<NormalizedRect | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setRect(null);
    setPendingRect(null);
    anchorRef.current = null;
  }, [pageIndex, active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, onCancel]);

  if (!active || !metrics) return null;

  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = layerRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return null;
    return {
      x: quantizeSelectionValue((event.clientX - bounds.left) / bounds.width, SELECTION_GRID),
      y: quantizeSelectionValue((event.clientY - bounds.top) / bounds.height, SELECTION_GRID),
    };
  };

  return (
    <div
      ref={layerRef}
      className="absolute z-40 overflow-hidden"
      style={{ left: metrics.left, top: metrics.top, width: metrics.width, height: metrics.height, touchAction: "none", cursor: "crosshair" }}
      onClick={event => event.stopPropagation()}
      onPointerDown={event => {
        event.preventDefault();
        event.stopPropagation();
        if (pendingRect) return;
        const point = pointFromEvent(event);
        if (!point) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        anchorRef.current = point;
        setRect({ x: point.x, y: point.y, width: 0, height: 0 });
      }}
      onPointerMove={event => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        event.preventDefault();
        const point = pointFromEvent(event);
        if (!point) return;
        setRect(rectFromPoints(anchor, point));
      }}
      onPointerUp={event => {
        const anchor = anchorRef.current;
        anchorRef.current = null;
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        const point = pointFromEvent(event) ?? anchor;
        const finalRect = rectFromPoints(anchor, point);
        setRect(null);
        // A tap or a box this small is treated as a cancel rather than a crop.
        if (!isUsableSelection(finalRect)) {
          onCancel();
          return;
        }
        setPendingRect({
          x: finalRect.x,
          y: finalRect.y,
          width: Math.min(finalRect.width, 1 - finalRect.x),
          height: Math.min(finalRect.height, 1 - finalRect.y),
        });
      }}
      onPointerCancel={() => {
        anchorRef.current = null;
        setRect(null);
      }}
      role="presentation"
      aria-label={`Select an area to translate on page ${pageIndex + 1}`}
    >
      {pendingRect ? (
        <div
          className="absolute border-2 border-emerald-400 bg-emerald-300/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ left: `${pendingRect.x * 100}%`, top: `${pendingRect.y * 100}%`, width: `${pendingRect.width * 100}%`, height: `${pendingRect.height * 100}%` }}
        >
          <div className="absolute left-1/2 top-full z-50 mt-2 flex -translate-x-1/2 gap-2 whitespace-nowrap rounded-lg bg-black/90 p-2 shadow-xl">
            <Button type="button" size="sm" className="h-8 bg-emerald-600 px-3 text-xs hover:bg-emerald-500" onClick={event => { event.stopPropagation(); const selected = pendingRect; setPendingRect(null); onSelected(selected); }}>
              <Check className="mr-1 h-3 w-3" /> Check bubble &amp; translate
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 border-white/40 bg-transparent px-3 text-xs text-white hover:bg-white/10" onClick={event => { event.stopPropagation(); setPendingRect(null); onCancel(); }}>
              <X className="mr-1 h-3 w-3" /> Redraw
            </Button>
          </div>
        </div>
      ) : rect && rect.width > 0 && rect.height > 0 ? (
        <div
          className="absolute border-2 border-dashed border-sky-400 bg-sky-300/10"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          }}
        />
      ) : (
        <div className="absolute inset-0 border-2 border-dashed border-sky-300/90 bg-black/20 shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.12)]">
          <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-black/75 px-3 py-1 text-xs font-medium text-white shadow-lg">
            Drag around one bubble
          </span>
        </div>
      )}
    </div>
  );
}
