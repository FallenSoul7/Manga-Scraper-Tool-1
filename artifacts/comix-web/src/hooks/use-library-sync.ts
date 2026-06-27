import { useState, useCallback, useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api-url";
import { useStore, storeActions, getStoreSnapshot } from "@/lib/storage";
import { getAccessToken } from "@/lib/auth-cache";
import { setSyncStatus } from "@/lib/sync-status";

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

export type SyncState = "idle" | "uploading" | "downloading" | "done" | "error";

export function useLibrarySync() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const installedSources = useStore(s => s.installedSources);
  
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState("");
  
  // Prevent the change-watcher from firing during startup sync
  const isFirstRender = useRef(true);
  const startupSyncDone = useRef(false);

  // ── Startup sync ───────────────────────────────────────────────────────────
  // On every app open (browser OR PWA), if the user is logged in:
  //   1. Push local state to cloud (merge) so local-only new items go up
  //   2. Pull the merged result back so cloud-only new items come down
  // This keeps browser and PWA in sync automatically without user action.
  useEffect(() => {
    if (startupSyncDone.current) return;
    startupSyncDone.current = true;

    const token = getAccessToken();
    if (!token) return; // Not logged in — nothing to do

    const snap = getStoreSnapshot();

    (async () => {
      setSyncStatus("syncing");
      try {
        // Step 1: push local → cloud (merge)
        await fetch(apiUrl("/api/library/sync"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            library: snap.library,
            categories: snap.categories,
            installedSources: snap.installedSources,
            strategy: "merge",
          }),
        });

        // Step 2: pull merged cloud state back into local store
        const res = await fetch(apiUrl("/api/library/sync"), {
          credentials: "include",
          headers: { ...authHeaders() },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.data) storeActions.restoreCloudSync(data.data);
        }
        setSyncStatus("done");
      } catch {
        // Offline or network error — silently skip, local data is fine
        setSyncStatus("error");
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Change-watcher: push to cloud whenever local data changes ──────────────
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Silently push to the cloud whenever data changes
    fetch(apiUrl("/api/library/sync"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ library, categories, installedSources, strategy: "merge" }),
    }).catch((err) => console.warn("Background auto-sync failed:", err));

  }, [library, categories, installedSources]);

  const uploadLibrary = useCallback(async () => {
    setState("uploading");
    setMessage("");
    try {
      const res = await fetch(apiUrl("/api/library/sync"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ library, categories, installedSources, strategy: "merge" }),
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
  }, [library, categories, installedSources]);

  const downloadLibrary = useCallback(async () => {
    setState("downloading");
    setMessage("");
    try {
      const res = await fetch(apiUrl("/api/library/sync"), {
        credentials: "include",
        headers: { ...authHeaders() },
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
