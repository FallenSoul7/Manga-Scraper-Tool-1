/**
 * IndexedDB store for device-owned offline chapters and download jobs.
 * Cache Storage holds the large media bodies; IndexedDB holds metadata and
 * deterministic keys so the reader can rebuild a chapter without the server.
 */
import { useSyncExternalStore } from 'react';
import type { OfflineTranslationRecord } from './translation-cache';

export interface OfflineVideoTrack {
  id: string;
  label: string;
  url: string;
  available?: boolean;
  audioLanguage?: string;
  subtitleLanguage?: string;
  kind: 'original' | 'dub' | 'sub';
}

export interface OfflinePage {
  index: number;
  url: string;
  videoTracks?: OfflineVideoTrack[];
  text?: string;
  title?: string;
}

export interface OfflineChapter {
  chapterId: string;
  mangaId: string;
  mangaTitle: string;
  mangaThumbnail: string;
  sourceId: string;
  chapterNumber: number;
  chapterTitle: string;
  /** Legacy flat URL list retained for older records. */
  pageUrls: string[];
  /** Structured pages preserve anime video tracks and novel metadata. */
  pages?: OfflinePage[];
  /** Exact Cache Storage key used for this chapter's page list. */
  pageListCacheKey?: string;
  downloadedAt: number;
  sizeBytes: number;
}

export interface OfflineDownloadJob {
  id: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error';
  updatedAt: number;
}

const DB_NAME = 'comihub-offline';
const DB_VERSION = 3;
const STORE_NAME = 'chapters';
const TRANSLATION_STORE = 'translations';
const DOWNLOAD_STORE = 'downloads';
let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'chapterId' });
        store.createIndex('mangaId', 'mangaId', { unique: false });
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(TRANSLATION_STORE)) {
        const store = db.createObjectStore(TRANSLATION_STORE, { keyPath: 'cacheKey' });
        store.createIndex('chapterId', 'chapterId', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
        store.createIndex('cachedAt', 'cachedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(DOWNLOAD_STORE)) {
        const store = db.createObjectStore(DOWNLOAD_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onblocked = () => reject(new Error('Close another ComiHub tab to finish updating offline storage.'));
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db?.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode: IDBTransactionMode, storeName = STORE_NAME) {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const offlineDb = {
  async list(): Promise<OfflineChapter[]> {
    const all = await wrap<OfflineChapter[]>(await tx('readonly').then(store => store.getAll()));
    return all.sort((a, b) => b.downloadedAt - a.downloadedAt);
  },
  async get(chapterId: string): Promise<OfflineChapter | null> {
    return (await wrap<OfflineChapter | undefined>(await tx('readonly').then(store => store.get(chapterId)))) ?? null;
  },
  async save(chapter: OfflineChapter): Promise<void> {
    await wrap((await tx('readwrite')).put(chapter));
    notifyOffline();
  },
  async getTranslation(cacheKey: string): Promise<OfflineTranslationRecord | null> {
    const record = (await wrap<OfflineTranslationRecord | undefined>(await tx('readonly', TRANSLATION_STORE).then(store => store.get(cacheKey)))) ?? null;
    if (record && record.expiresAt > Date.now()) return record;
    if (record) await wrap((await tx('readwrite', TRANSLATION_STORE)).delete(cacheKey));
    return null;
  },
  async saveTranslation(record: OfflineTranslationRecord): Promise<void> {
    await wrap((await tx('readwrite', TRANSLATION_STORE)).put(record));
    const all = await wrap<OfflineTranslationRecord[]>(await tx('readonly', TRANSLATION_STORE).then(store => store.getAll()));
    if (all.length > 1000) {
      all.sort((a, b) => a.cachedAt - b.cachedAt);
      const prune = await tx('readwrite', TRANSLATION_STORE);
      for (const stale of all.slice(0, all.length - 1000)) await wrap(prune.delete(stale.cacheKey));
    }
  },
  async delete(chapterId: string): Promise<void> {
    const chapter = await offlineDb.get(chapterId);
    if (chapter) return offlineDb.deleteWithPages(chapter);
    await wrap((await tx('readwrite')).delete(chapterId));
    notifyOffline();
  },
  async deleteWithPages(chapter: OfflineChapter): Promise<void> {
    await wrap((await tx('readwrite')).delete(chapter.chapterId));
    try {
      const imageCache = await caches.open('comihub-offline-v1');
      const pagesCache = await caches.open('comihub-offline-pages-v1');
      const urls = chapter.pages?.map(page => page.url) ?? chapter.pageUrls;
      await Promise.all([
        ...urls.map(url => imageCache.delete(url).catch(() => false)),
        chapter.pageListCacheKey
          ? pagesCache.delete(chapter.pageListCacheKey).catch(() => false)
          : Promise.resolve(false),
      ]);
    } catch { /* Cache Storage may be unavailable in a non-secure preview. */ }
    notifyOffline();
  },
  async listDownloadJobs(): Promise<OfflineDownloadJob[]> {
    const all = await wrap<OfflineDownloadJob[]>(await tx('readonly', DOWNLOAD_STORE).then(store => store.getAll()));
    return all.sort((a, b) => a.updatedAt - b.updatedAt);
  },
  async saveDownloadJob(job: OfflineDownloadJob): Promise<void> {
    await wrap((await tx('readwrite', DOWNLOAD_STORE)).put(job));
  },
  async deleteDownloadJob(id: string): Promise<void> {
    await wrap((await tx('readwrite', DOWNLOAD_STORE)).delete(id));
  },
  async clearDownloadJobs(): Promise<void> {
    await wrap((await tx('readwrite', DOWNLOAD_STORE)).clear());
  },
};

const offlineSubscribers = new Set<() => void>();
let offlineSnapshot: OfflineChapter[] = [];
function notifyOffline() {
  offlineDb.list().then(list => {
    offlineSnapshot = list;
    offlineSubscribers.forEach(cb => cb());
  });
}
offlineDb.list().then(list => { offlineSnapshot = list; offlineSubscribers.forEach(cb => cb()); }).catch(() => {});
export function useOfflineChapters(): OfflineChapter[] {
  return useSyncExternalStore(
    cb => { offlineSubscribers.add(cb); return () => offlineSubscribers.delete(cb); },
    () => offlineSnapshot,
    () => offlineSnapshot,
  );
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
