/**
 * download-queue.ts
 * Real chapter download engine — fetches pages from the API and caches them in
 * Cache Storage (comihub-offline-v1) for offline PWA reading.
 *
 * Public API is backward-compatible with the previous fake-queue implementation
 * so existing callers (ChapterDownloadButton etc.) need no changes.
 */
import { useSyncExternalStore } from 'react';
import { apiUrl }   from './api-url';
import { offlineDb } from './offline-db';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  mangaId: string;
  mangaTitle: string;
  mangaThumbnail: string;
  sourceId?: string;
  chapterId: number | string;
  chapterNumber: number;
  chapterTitle: string;
  progress: number;          // 0–100
  pagesTotal: number;        // 0 until pages list is fetched
  pagesDownloaded: number;
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error';
}

interface QueueState {
  items: QueueItem[];
  globalPaused: boolean;     // pauses ALL downloads (renamed from 'paused' for clarity)
  concurrentCount: number;
}

type EnqueueInput = Omit<QueueItem, 'id' | 'progress' | 'status' | 'pagesTotal' | 'pagesDownloaded'>;

// ─── State ────────────────────────────────────────────────────────────────────

let state: QueueState = {
  items: [],
  globalPaused: false,
  concurrentCount: 1,
};

const subscribers = new Set<() => void>();

function notify() { subscribers.forEach(cb => cb()); }

function getSnapshot(): QueueState { return state; }

export function useDownloadQueue<T>(selector: (s: QueueState) => T): T {
  return useSyncExternalStore(
    cb => { subscribers.add(cb); return () => subscribers.delete(cb); },
    () => selector(getSnapshot()),
    () => selector(getSnapshot()),
  );
}

// Back-compat selector: expose `paused` (globalPaused) so old code works
Object.defineProperty(getSnapshot(), 'paused', {
  get() { return state.globalPaused; }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Route a raw CDN image URL through the backend image proxy so that
 * hotlink-protection headers (Referer, etc.) are set server-side.
 * URLs that are already local API paths are left as-is.
 */
function buildProxiedUrl(rawUrl: string, sourceId: string): string {
  if (!rawUrl) return rawUrl;
  if (rawUrl.startsWith('/api/') || rawUrl.startsWith('/public/')) {
    return apiUrl(rawUrl);
  }
  return apiUrl(`/api/image?url=${encodeURIComponent(rawUrl)}&source=${encodeURIComponent(sourceId)}`);
}

function getItem(id: string): QueueItem | undefined {
  return state.items.find(i => i.id === id);
}

function mutateItem(id: string, patch: Partial<QueueItem>) {
  state = {
    ...state,
    items: state.items.map(i => i.id === id ? { ...i, ...patch } : i),
  };
  notify();
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// ─── Download loop ────────────────────────────────────────────────────────────

/** Tracks running async download tasks by item ID */
const inFlight = new Map<string, { cancelled: boolean }>();

/** Called whenever queue state changes — starts new downloads if slots are free */
function scheduleDownloads() {
  if (state.globalPaused) return;

  const downloading = state.items.filter(i => i.status === 'downloading').length;
  const queued      = state.items.filter(i => i.status === 'queued');
  const slots       = state.concurrentCount - downloading;

  if (slots <= 0 || queued.length === 0) return;

  for (const item of queued.slice(0, slots)) {
    mutateItem(item.id, { status: 'downloading' });
    runDownload(item.id); // fire-and-forget
  }
}

/** Core async download for a single chapter */
async function runDownload(id: string): Promise<void> {
  const handle = { cancelled: false };
  inFlight.set(id, handle);

  try {
    const item = getItem(id);
    if (!item) return;

    // ── Step 1: fetch page URL list ─────────────────────────────────────────
    const pagesRes = await fetch(apiUrl(`/api/chapter/${item.chapterId}/pages`), {
      headers: { 'x-source': item.sourceId ?? '' },
    });
    if (!pagesRes.ok || handle.cancelled) throw new Error('pages fetch failed');

    const raw = await pagesRes.json();
    const pageUrls: string[] = Array.isArray(raw) ? raw : (raw.pages ?? raw.data ?? []);

    if (pageUrls.length === 0) throw new Error('empty page list');
    mutateItem(id, { pagesTotal: pageUrls.length });

    // Cache the pages list so the reader can load it offline
    try {
      const pagesCache = await caches.open('comihub-offline-pages-v1');
      const key = apiUrl(`/api/chapter/${item.chapterId}/pages`);
      await pagesCache.put(
        key,
        new Response(JSON.stringify(pageUrls), {
          headers: { 'Content-Type': 'application/json', 'sw-cached-at': Date.now().toString() },
        }),
      );
    } catch { /* caches unavailable (dev/HTTP) — continue */ }

    // ── Step 2: fetch & cache each page image via proxy ─────────────────────
    // Using the backend image proxy for every image ensures hotlink-protection
    // headers (Referer etc.) are set correctly — direct CDN fetches get 403.
    const CHUNK = 3;
    let downloaded = getItem(id)?.pagesDownloaded ?? 0;
    let totalBytes = 0;

    const imageCache = await caches.open('comihub-offline-v1').catch(() => null);
    const sid = item.sourceId ?? '';

    // Build proxied URLs once — these become the stable cache keys AND the
    // URLs stored in IndexedDB so the reader can hit the cache offline.
    const proxiedUrls = pageUrls.map(u => buildProxiedUrl(u, sid));

    for (let i = downloaded; i < proxiedUrls.length && !handle.cancelled; i += CHUNK) {
      // Respect per-item pause
      while (getItem(id)?.status === 'paused' && !handle.cancelled) {
        await sleep(400);
      }
      if (handle.cancelled) break;

      // Respect global pause
      while (state.globalPaused && !handle.cancelled) {
        await sleep(400);
      }
      if (handle.cancelled) break;

      const chunk = proxiedUrls.slice(i, Math.min(i + CHUNK, proxiedUrls.length));

      await Promise.all(chunk.map(async proxiedUrl => {
        if (handle.cancelled) return;
        try {
          const res = await fetch(proxiedUrl);
          if (res.ok && imageCache) {
            const buf = await res.arrayBuffer();
            totalBytes += buf.byteLength;
            await imageCache.put(
              proxiedUrl,
              new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'sw-cached-at': Date.now().toString() } }),
            );
          }
        } catch { /* skip failed images — progress continues */ }
      }));

      downloaded = Math.min(i + CHUNK, proxiedUrls.length);
      mutateItem(id, {
        pagesDownloaded: downloaded,
        progress: Math.round((downloaded / proxiedUrls.length) * 100),
      });
    }

    if (handle.cancelled) return;

    // ── Step 3: persist metadata to IndexedDB ───────────────────────────────
    const finalItem = getItem(id);
    if (finalItem && downloaded >= proxiedUrls.length) {
      // Store proxied URLs — reader will request these exact keys, hitting the cache offline
      const resolvedUrls = proxiedUrls;
      await offlineDb.save({
        chapterId:      String(finalItem.chapterId),
        mangaId:        finalItem.mangaId,
        mangaTitle:     finalItem.mangaTitle,
        mangaThumbnail: finalItem.mangaThumbnail,
        sourceId:       finalItem.sourceId ?? '',
        chapterNumber:  finalItem.chapterNumber,
        chapterTitle:   finalItem.chapterTitle,
        pageUrls:       resolvedUrls,
        downloadedAt:   Date.now(),
        sizeBytes:      totalBytes,
      });

      // Mark in library store for the "downloaded" badge
      import('./storage').then(({ storeActions }) => {
        storeActions.markMangaDownloaded(finalItem.mangaId);
      });

      mutateItem(id, { status: 'done', progress: 100 });
      scheduleDownloads(); // kick off the next queued chapter
    }
  } catch {
    if (!handle.cancelled) {
      mutateItem(id, { status: 'error' });
      scheduleDownloads();
    }
  } finally {
    inFlight.delete(id);
  }
}

// ─── Public actions ───────────────────────────────────────────────────────────

export const queueActions = {
  enqueue(input: EnqueueInput) {
    // Don't re-add if already in queue (any status)
    if (state.items.some(i => String(i.chapterId) === String(input.chapterId))) return;

    const item: QueueItem = {
      ...input,
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      progress: 0,
      pagesTotal: 0,
      pagesDownloaded: 0,
      status: 'queued',
    };
    state = { ...state, items: [...state.items, item] };
    notify();
    scheduleDownloads();
  },

  enqueueMany(inputs: EnqueueInput[]) {
    const fresh = inputs.filter(
      inp => !state.items.some(i => String(i.chapterId) === String(inp.chapterId)),
    );
    if (fresh.length === 0) return;

    const newItems: QueueItem[] = fresh.map(input => ({
      ...input,
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      progress: 0,
      pagesTotal: 0,
      pagesDownloaded: 0,
      status: 'queued' as const,
    }));
    state = { ...state, items: [...state.items, ...newItems] };
    notify();
    scheduleDownloads();
  },

  /** Remove a single chapter from the queue and cancel any in-flight fetch */
  remove(id: string) {
    const handle = inFlight.get(id);
    if (handle) handle.cancelled = true;
    state = { ...state, items: state.items.filter(i => i.id !== id) };
    notify();
  },

  clearDone() {
    state = { ...state, items: state.items.filter(i => i.status !== 'done') };
    notify();
  },

  /** Pause a specific chapter (it will finish its current page chunk then stop) */
  pauseItem(id: string) {
    const item = getItem(id);
    if (!item || item.status === 'paused' || item.status === 'done') return;
    mutateItem(id, { status: 'paused' });
  },

  /** Resume a specific paused chapter */
  resumeItem(id: string) {
    const item = getItem(id);
    if (!item || item.status !== 'paused') return;
    mutateItem(id, { status: 'queued' });
    scheduleDownloads();
  },

  /** Move item UP in queue priority (swaps with the previous active item) */
  moveUp(id: string) {
    const items  = [...state.items];
    const idx    = items.findIndex(i => i.id === id);
    if (idx <= 0) return;
    // Find previous active (queued/downloading/paused)
    let prevIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (['queued', 'downloading', 'paused'].includes(items[i].status)) { prevIdx = i; break; }
    }
    if (prevIdx === -1) return;
    [items[prevIdx], items[idx]] = [items[idx], items[prevIdx]];
    state = { ...state, items };
    notify();
  },

  /** Move item DOWN in queue priority (swaps with the next active item) */
  moveDown(id: string) {
    const items  = [...state.items];
    const idx    = items.findIndex(i => i.id === id);
    if (idx < 0 || idx >= items.length - 1) return;
    let nextIdx = -1;
    for (let i = idx + 1; i < items.length; i++) {
      if (['queued', 'downloading', 'paused'].includes(items[i].status)) { nextIdx = i; break; }
    }
    if (nextIdx === -1) return;
    [items[nextIdx], items[idx]] = [items[idx], items[nextIdx]];
    state = { ...state, items };
    notify();
  },

  /** Pause / resume ALL downloads */
  togglePause() {
    state = { ...state, globalPaused: !state.globalPaused };
    notify();
    if (!state.globalPaused) scheduleDownloads();
  },

  /** Set how many chapters can download simultaneously */
  setConcurrent(n: number) {
    state = { ...state, concurrentCount: Math.max(1, Math.min(5, n)) };
    notify();
    scheduleDownloads();
  },
};
