import { useSyncExternalStore } from "react";

export type SyncStatus = "idle" | "syncing" | "done" | "error";

let _status: SyncStatus = "idle";
let _doneTimer: ReturnType<typeof setTimeout> | null = null;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach(cb => cb());
}

export function getSyncStatus(): SyncStatus {
  return _status;
}

export function setSyncStatus(s: SyncStatus) {
  if (_doneTimer) { clearTimeout(_doneTimer); _doneTimer = null; }
  _status = s;
  notify();
  // Auto-return to idle 2.5 s after "done" or "error"
  if (s === "done" || s === "error") {
    _doneTimer = setTimeout(() => {
      _status = "idle";
      _doneTimer = null;
      notify();
    }, 2500);
  }
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    getSyncStatus,
    getSyncStatus,
  );
}
