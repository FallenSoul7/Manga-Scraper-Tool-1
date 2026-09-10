/**
 * bg-fetch.ts
 * Background Fetch API helper for Chrome/Edge/Android.
 *
 * When supported, downloads continue even if the tab is closed or the
 * browser is backgrounded. The OS shows a native progress notification.
 *
 * On unsupported browsers (Safari/iOS, Firefox), callers should fall back
 * to the in-app download queue (download-queue.ts).
 */

export interface BgFetchOptions {
  /** Unique ID for this background fetch job */
  id: string;
  /** Title shown in the OS-level download notification */
  title: string;
  /** Array of URLs to download (already proxied through the backend) */
  urls: string[];
  /** Total download size in bytes (optional — used for progress UI) */
  estimatedSize?: number;
}

interface BackgroundFetchRegistration {
  abort(): Promise<boolean>;
  matchAll(): Promise<Response[]>;
}

export function isBackgroundFetchSupported(): boolean {
  return typeof self !== 'undefined' && 'BackgroundFetchManager' in self;
}

/**
 * Register a background fetch job. Returns the BackgroundFetchRegistration
 * or null if the API is not supported or the registration failed.
 */
export async function registerBackgroundFetch(
  opts: BgFetchOptions,
): Promise<BackgroundFetchRegistration | null> {
  if (!isBackgroundFetchSupported()) return null;

  try {
    const reg = await (self as any).serviceWorker?.ready;
    if (!reg) return null;

    const bgFetch = await (reg as any).backgroundFetch.fetch(
      opts.id,
      opts.urls,
      {
        title: opts.title,
        downloadTotal: opts.estimatedSize,
      },
    );

    return bgFetch as BackgroundFetchRegistration;
  } catch {
    return null;
  }
}

/**
 * Get an active background fetch by ID, or null if not found.
 */
export async function getBackgroundFetch(
  id: string,
): Promise<BackgroundFetchRegistration | null> {
  if (!isBackgroundFetchSupported()) return null;

  try {
    const reg = await (self as any).serviceWorker?.ready;
    if (!reg) return null;
    return (await (reg as any).backgroundFetch.get(id)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Abort an active background fetch by ID.
 */
export async function abortBackgroundFetch(id: string): Promise<void> {
  const bgFetch = await getBackgroundFetch(id);
  if (bgFetch) {
    try {
      await bgFetch.abort();
    } catch {
      // Already completed or aborted
    }
  }
}

// ─── Service Worker side helpers ──────────────────────────────────────────────

/**
 * Called from the service worker's `backgroundfetchsuccess` event.
 * Caches all downloaded responses into the offline cache so they are
 * available for offline reading.
 */
export async function cacheBgFetchResults(
  bgFetchRegistration: BackgroundFetchRegistration,
): Promise<void> {
  const cache = await caches.open('comihub-offline-v1');
  const responses = await bgFetchRegistration.matchAll();

  for (const response of responses) {
    const url = response.url;
    if (!url) continue;

    const ct = response.headers.get('Content-Type') || '';
    if (ct.startsWith('image/') || ct.startsWith('application/octet-stream')) {
      await cache.put(url, response.clone());
    }
  }
}

/**
 * Notify all open client tabs that a background fetch completed.
 * The app uses this to update the download queue UI.
 */
export async function notifyClients(
  type: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const clients = await (self as any).clients?.matchAll?.() ?? [];
  for (const client of clients) {
    client.postMessage({ type, ...data });
  }
}
