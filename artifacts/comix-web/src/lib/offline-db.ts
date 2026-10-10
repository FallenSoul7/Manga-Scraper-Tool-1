/**
 * offline-db.ts
 * IndexedDB store for chapters downloaded to the app (offline PWA storage).
 * Separate from the download queue which lives in RAM — this persists across sessions.
 */
import { useSyncExternalStore } from 'react';
import type { OfflineTranslationRecord } from './translation-cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfflineChapter {
  chapterId: string;
  mangaId: string;
  mangaTitle: string;
  mangaThumbnail: string;
  sourceId: string;
  chapterNumber: number;
  chapterTitle: string;
  /** Fully-resolved page URLs that are stored in comihub-offline-v1 cache */
  pageUrls: string[];
  downloadedAt: number;
  /** Approximate size in bytes (sum of cached image sizes) */
  sizeBytes: number;
}

// ─── DB bootstrap ─────────────────────────────────────────────────────────────

const DB_NAME    = 'comihub-offline';
const DB_VERSION = 2;
const STORE_NAME = 'chapters';
const TRANSLATION_STORE = 'translations';

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'chapterId' });
        store.createIndex('mangaId',      'mangaId',      { unique: false });
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(TRANSLATION_STORE)) {
        const store = db.createObjectStore(TRANSLATION_STORE, { keyPath: 'cacheKey' });
        store.createIndex('chapterId', 'chapterId', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
        store.createIndex('cachedAt', 'cachedAt', { unique: false });
      }
    };
    req.onblocked = () => reject(new Error('Close another ComiHub tab to finish updating offline storage.'));
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db?.close(); _db = null; };
      resolve(_db);
    };
    req.onerror   = () => reject(req.error);
  });
}

function tx(mode: IDBTransactionMode, storeName = STORE_NAME) {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const offlineDb = {
  async list(): Promise<OfflineChapter[]> {
    const store = await tx('readonly');
    const all   = await wrap<OfflineChapter[]>(store.getAll());
    return all.sort((a, b) => b.downloadedAt - a.downloadedAt);
  },

  async get(chapterId: string): Promise<OfflineChapter | null> {
    const store = await tx('readonly');
    return (await wrap<OfflineChapter | undefined>(store.get(chapterId))) ?? null;
  },

  async save(chapter: OfflineChapter): Promise<void> {
    const store = await tx('readwrite');
    await wrap(store.put(chapter));
    notifyOffline();
  },

  async getTranslation(cacheKey: string): Promise<OfflineTranslationRecord | null> {
    const store = await tx('readonly', TRANSLATION_STORE);
    const record = (await wrap<OfflineTranslationRecord | undefined>(store.get(cacheKey))) ?? null;
    if (record && record.expiresAt > Date.now()) return record;
    if (record) {
      const writeStore = await tx('readwrite', TRANSLATION_STORE);
      await wrap(writeStore.delete(cacheKey));
    }
    return null;
  },

  async saveTranslation(record: OfflineTranslationRecord): Promise<void> {
    const writeStore = await tx('readwrite', TRANSLATION_STORE);
    await wrap(writeStore.put(record));
    const readStore = await tx('readonly', TRANSLATION_STORE);
    const all = await wrap<OfflineTranslationRecord[]>(readStore.getAll());
    if (all.length > 1000) {
      all.sort((a, b) => a.cachedAt - b.cachedAt);
      const pruneStore = await tx('readwrite', TRANSLATION_STORE);
      for (const stale of all.slice(0, all.length - 1000)) await wrap(pruneStore.delete(stale.cacheKey));
    }
  },

  async delete(chapterId: string): Promise<void> {
    const chapter = await offlineDb.get(chapterId);
    if (chapter) {
      await offlineDb.deleteWithPages(chapter);
      return;
    }
    const store = await tx('readwrite');
    await wrap(store.delete(chapterId));
    notifyOffline();
  },

  async deleteWithPages(chapter: OfflineChapter): Promise<void> {
    // Remove from IndexedDB
    const store = await tx('readwrite');
    await wrap(store.delete(chapter.chapterId));

    // Remove cached page images
    try {
      const imageCache = await caches.open('comihub-offline-v1');
      const pagesCache = await caches.open('comihub-offline-pages-v1');
      await Promise.all([
        ...chapter.pageUrls.map(url => imageCache.delete(url).catch(() => {})),
        pagesCache.delete(new Request(chapter.pageUrls[0]?.split('/api/')[0] ?? '')).catch(() => {}),
      ]);
    } catch {}

    notifyOffline();
  },
};

// ─── Reactive hook ────────────────────────────────────────────────────────────
// Subscribes to offline library changes so the UI re-renders when chapters
// are added or removed.

const offlineSubscribers = new Set<() => void>();
let offlineSnapshot: OfflineChapter[] = [];
let offlineLoaded = false;

function notifyOffline() {
  // Re-fetch from DB and notify subscribers
  offlineDb.list().then(list => {
    offlineSnapshot = list;
    offlineSubscribers.forEach(cb => cb());
  });
}

// Initial load
offlineDb.list().then(list => {
  offlineSnapshot  = list;
  offlineLoaded    = true;
  offlineSubscribers.forEach(cb => cb());
}).catch(() => {});

export function useOfflineChapters(): OfflineChapter[] {
  return useSyncExternalStore(
    cb => { offlineSubscribers.add(cb); return () => offlineSubscribers.delete(cb); },
    () => offlineSnapshot,
    () => offlineSnapshot,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
