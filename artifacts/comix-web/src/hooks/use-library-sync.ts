import { useState, useCallback } from "react";
import { apiUrl } from "@/lib/api-url";
import { useStore, storeActions } from "@/lib/storage";

export type SyncState = "idle" | "uploading" | "downloading" | "done" | "error";

export function useLibrarySync() {
  const library = useStore(s => s.library);
  const categories = useStore(s => s.categories);
  const installedSources = useStore(s => s.installedSources);
  
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState("");

  const uploadLibrary = useCallback(async () => {
    setState("uploading");
    setMessage("");
    try {
      const res = await fetch(apiUrl("/api/library/sync"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // ✅ Send everything
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
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      
      const responseData = await res.json();
      
      // ✅ Use our new action to restore everything perfectly
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
