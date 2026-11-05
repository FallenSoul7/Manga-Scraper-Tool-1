import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api-url";
import { useStore, storeActions, getStoreSnapshot } from "@/lib/storage";
import { getCachedUser } from "@/lib/auth-cache";
import { setSyncStatus } from "@/lib/sync-status";

export type SyncState = "idle" | "uploading" | "downloading" | "done" | "error";

export function useLibrarySync() {
  const library = useStore(s => s.library);
  const deletedLibraryItems = useStore(s => s.deletedLibraryItems);
  const categories = useStore(s => s.categories);
  const installedSources = useStore(s => s.installedSources);
  const progress = useStore(s => s.progress);
  const history = useStore(s => s.history);
  
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState("");
  
  // Track the first ready transition so startup sync owns the initial merge.
  const isFirstRender = useRef(true);
  const startupSyncDone = useRef(false);
  const syncInProgress = useRef(false);
  const { data: backendReady = false } = useQuery<boolean>({
    queryKey: ["backend-ready"],
    queryFn: async () => false,
    initialData: false,
    staleTime: Infinity,
    enabled: false,
  });
  const backendWasReady = useRef(backendReady);

  // ── Startup sync ───────────────────────────────────────────────────────────
  // On every app open, once the backend is healthy, if the user is logged in:
  //   1. Push local state to cloud (merge) so local-only new items go up
  //   2. Pull the merged result back so cloud-only new items come down
  // This keeps browser and PWA in sync automatically without user action.
  useEffect(() => {
    if (!backendReady) {
      if (!syncInProgress.current) startupSyncDone.current = false;
      return;
    }
    if (startupSyncDone.current || syncInProgress.current) return;
    if (!getCachedUser()) return;

    startupSyncDone.current = true;
    syncInProgress.current = true;
    const snap = getStoreSnapshot();

    (async () => {
      setSyncStatus("syncing");
      try {
        // Step 1: push local → cloud (merge)
        const upload = await fetch(apiUrl("/api/library/sync"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            library: snap.library,
            deletedLibraryItems: snap.deletedLibraryItems,
            categories: snap.categories,
            installedSourceIds: Object.keys(snap.installedSources),
            progress: snap.progress,
            history: snap.history,
            strategy: "merge",
          }),
        });
        if (!upload.ok) throw new Error("Cloud sync upload failed");

        // Step 2: pull merged cloud state back into local store
        const res = await fetch(apiUrl("/api/library/sync"), {
          credentials: "include",
          headers: {},
        });
        if (!res.ok) throw new Error("Cloud sync download failed");
        const data = await res.json();
        if (data?.data) storeActions.restoreCloudSync(data.data);
        setSyncStatus("done");
      } catch {
        // Keep local data intact and allow another attempt after recovery.
        setSyncStatus("error");
        startupSyncDone.current = false;
      } finally {
        syncInProgress.current = false;
      }
    })();
  }, [backendReady]);

  // ── Change-watcher: push to cloud whenever local data changes ──────────────
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!backendReady) {
      backendWasReady.current = false;
      return;
    }
    if (!backendWasReady.current) {
      backendWasReady.current = true;
      return;
    }

    // Silently push to the cloud whenever data changes
    fetch(apiUrl("/api/library/sync"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ library, deletedLibraryItems, categories, installedSourceIds: Object.keys(installedSources), progress, history, strategy: "merge" }),
    }).catch(() => {});

  }, [library, deletedLibraryItems, categories, installedSources, progress, history, backendReady]);

  const uploadLibrary = useCallback(async () => {
    setState("uploading");
    setMessage("");
    try {
      const res = await fetch(apiUrl("/api/library/sync"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library, deletedLibraryItems, categories, installedSourceIds: Object.keys(installedSources), progress, history, strategy: "merge" }),
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      
      if (!data.ok && data.warning) {
        setState("error");
        setMessage(`⚠️ ${data.warning}`);
        return;
      }
      
      setState("done");
      setMessage(`Cloud sync completed successfully`);
    } catch (err: any) {
      setState("error");
      setMessage(err.message ?? "Upload failed");
    }
  }, [library, deletedLibraryItems, categories, installedSources, progress, history]);

  const downloadLibrary = useCallback(async () => {
    setState("downloading");
    setMessage("");
    try {
      const res = await fetch(apiUrl("/api/library/sync"), {
        credentials: "include",
        headers: {},
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      
      const responseData = await res.json();
      
      if (responseData.data) {
        storeActions.restoreCloudSync(responseData.data);
      }

      setState("done");
      setMessage(`Data restored from the cloud`);
    } catch (err: any) {
      setState("error");
      setMessage(err.message ?? "Download failed");
    }
  }, []);

  return { state, message, uploadLibrary, downloadLibrary, setState };
}
