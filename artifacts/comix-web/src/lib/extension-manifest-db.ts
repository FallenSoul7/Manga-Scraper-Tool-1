const DB_NAME = "comihub-extension-manifests";
const DB_VERSION = 1;
const STORE_NAME = "manifests";
const MAX_MANIFEST_JSON_CHARS = 256 * 1024;
const SOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;

export interface CachedExtensionManifest {
  sourceId: string;
  manifest: unknown;
  savedAt: number;
}

function openManifestDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "sourceId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local manifest store."));
    request.onblocked = () => reject(new Error("The local manifest database upgrade is blocked."));
  });
}

/** Persist only bounded JSON data supplied after caller-side schema validation. */
export async function cacheExtensionManifest(sourceId: string, manifest: unknown): Promise<void> {
  if (!SOURCE_ID_RE.test(sourceId)) throw new TypeError("Invalid extension source ID.");
  const serialized = JSON.stringify(manifest);
  if (!serialized || serialized.length > MAX_MANIFEST_JSON_CHARS) {
    throw new TypeError("Extension manifest JSON is missing or exceeds the local size limit.");
  }
  const safeJson = JSON.parse(serialized) as unknown;
  const db = await openManifestDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ sourceId, manifest: safeJson, savedAt: Date.now() } satisfies CachedExtensionManifest);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save the local manifest."));
      tx.onabort = () => reject(tx.error ?? new Error("The local manifest write was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function getCachedExtensionManifest(sourceId: string): Promise<CachedExtensionManifest | null> {
  if (!SOURCE_ID_RE.test(sourceId)) return null;
  const db = await openManifestDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(sourceId);
      request.onsuccess = () => resolve((request.result as CachedExtensionManifest | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the local manifest."));
    });
  } finally {
    db.close();
  }
}

export async function removeCachedExtensionManifest(sourceId: string): Promise<void> {
  if (!SOURCE_ID_RE.test(sourceId)) return;
  const db = await openManifestDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(sourceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not remove the local manifest."));
      tx.onabort = () => reject(tx.error ?? new Error("The local manifest removal was aborted."));
    });
  } finally {
    db.close();
  }
}
