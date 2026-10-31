import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore, type StoreState } from "@/lib/storage";
import { mediaImage } from "@/lib/utils";

const STORAGE_KEY = "comihub-offline-catalog-v2";

export interface OfflineCatalogSnapshot {
  version: 1;
  updatedAt: number;
  library: StoreState["library"];
  categories: StoreState["categories"];
  progress: StoreState["progress"];
  history: StoreState["history"];
  installedSources: StoreState["installedSources"];
}

let snapshot: OfflineCatalogSnapshot | null = readSnapshot();
const listeners = new Set<() => void>();

function readSnapshot(): OfflineCatalogSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value?.version !== 1) return null;
    const { sourceCatalog: _obsoleteCatalog, ...state } = value;
    return state as OfflineCatalogSnapshot;
  } catch {
    return null;
  }
}

function publish(next: OfflineCatalogSnapshot) {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Offline snapshots are best-effort; primary application state remains in its own storage.
  }
  listeners.forEach(listener => listener());
}

export function getOfflineCatalog(): OfflineCatalogSnapshot | null {
  return snapshot;
}

export function saveOfflineCatalogState(state: Pick<
  StoreState,
  "library" | "categories" | "progress" | "history" | "installedSources"
>) {
  publish({
    version: 1,
    updatedAt: Date.now(),
    ...state,
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

export function useOfflineCatalog() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigatorOnline());

  useEffect(() => {
    const update = () => setOnline(navigatorOnline());
    // Standalone mobile apps can briefly report offline during the first paint.
    const probe = () => {
      if (typeof window === "undefined") return;
      fetch(`${window.location.origin}/`, { method: "HEAD", cache: "no-store" })
        .then(() => setOnline(true))
        .catch(() => {});
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const timer = window.setTimeout(probe, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

function navigatorOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function OfflineCatalogPersistence() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const progress = useStore(s => s.progress);
  const history = useStore(s => s.history);
  const installedSources = useStore(s => s.installedSources);

  useEffect(() => {
    saveOfflineCatalogState({ library, categories, progress, history, installedSources });
    if (navigatorOnline() && typeof window !== "undefined") {
      const coverUrls = Object.values(library)
        .map(manga => mediaImage(manga.thumbnail, manga.sourceId))
        .filter(Boolean);
      const iconUrls = Object.values(installedSources)
        .map(source => source.iconUrl)
        .filter((url): url is string => !!url)
        .map(url => url.startsWith("/") ? `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")}${url}` : url);
      void Promise.all([...coverUrls, ...iconUrls].map(url =>
        fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => undefined),
      ));
    }
  }, [library, categories, progress, history, installedSources]);

  return null;
}
