import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore, getStoreSnapshot, type StoreState } from "@/lib/storage";
import { proxyImage } from "@/lib/utils";

const STORAGE_KEY = "comihub-offline-catalog-v1";

export interface OfflineCatalogSnapshot {
  version: 1;
  updatedAt: number;
  library: StoreState["library"];
  categories: StoreState["categories"];
  progress: StoreState["progress"];
  history: StoreState["history"];
  installedSources: StoreState["installedSources"];
  sourceCatalog: unknown | null;
}

let snapshot: OfflineCatalogSnapshot | null = readSnapshot();
const listeners = new Set<() => void>();

function readSnapshot(): OfflineCatalogSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return value?.version === 1 ? value : null;
  } catch {
    return null;
  }
}

function publish(next: OfflineCatalogSnapshot) {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The app's primary state remains in its existing storage. A catalog
    // snapshot is best-effort so a full device never blocks local reading.
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
    sourceCatalog: snapshot?.sourceCatalog ?? null,
  });
}

export function saveOfflineSourceCatalog(sourceCatalog: unknown) {
  const state = getStoreSnapshot();
  saveOfflineCatalogState({
    library: state.library,
    categories: state.categories,
    progress: state.progress,
    history: state.history,
    installedSources: state.installedSources,
  });
  publish({ ...snapshot!, sourceCatalog });
}

export function getCachedSourceCatalog<T = any>(): T | null {
  return (snapshot?.sourceCatalog as T | null) ?? null;
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
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
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
        .map(manga => proxyImage(manga.thumbnail, manga.sourceId))
        .filter(Boolean);
      const iconUrls = Object.values(installedSources)
        .map(source => source.iconUrl)
        .filter((url): url is string => !!url)
        .map(url => url.startsWith("/") ? `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")}${url}` : url);
      void Promise.all([...coverUrls, ...iconUrls].map(url =>
        fetch(url, { credentials: "omit" }).catch(() => undefined),
      ));
    }
  }, [library, categories, progress, history, installedSources]);

  return null;
}