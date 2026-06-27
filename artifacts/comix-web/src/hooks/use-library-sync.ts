import { useState, useCallback } from "react";
import { apiUrl } from "@/lib/api-url";
import { useStore, storeActions, type SavedManga } from "@/lib/storage";

export type SyncState = "idle" | "uploading" | "downloading" | "done" | "error";

export function useLibrarySync() {
  const library = useStore(s => s.library);
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
        body: JSON.stringify({ library, strategy: "merge" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      // ✅ FIX: Handle partial failure (DB issue) — library.ts now returns 200
      //         with ok:false + warning instead of crashing with 500.
      if (!data.ok && data.warning) {
        setState("error");
        setMessage(`⚠️ ${data.warning}`);
        return;
      }
      setState("done");
      setMessage(`${data.count} titles saved to the cloud`);
    } catch (err: any) {
      setState("error");
      setMessage(err.message ?? "Upload failed");
    }
  }, [library]);

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
      const data = await res.json();
      const cloud = data.library as Record<string, SavedManga>;

      // Merge cloud into local — cloud entry wins if it has a newer or equal addedAt
      const merged = { ...library };
      let added = 0;
      for (const [id, entry] of Object.entries(cloud)) {
        if (!merged[id] || (entry.addedAt ?? 0) >= (merged[id].addedAt ?? 0)) {
          merged[id] = entry;
          added++;
        }
      }
      storeActions.setLibrary(merged);

      setState("done");
      setMessage(`${added} titles restored from the cloud`);
    } catch (err: any) {
      setState("error");
      setMessage(err.message ?? "Download failed");
    }
  }, [library]);

  return { state, message, uploadLibrary, downloadLibrary, setState };
}
