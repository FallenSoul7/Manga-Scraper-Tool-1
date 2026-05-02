import { useEffect, useSyncExternalStore } from "react";

export interface HistoryHeaderScope {
  onSearchClick: () => void;
  onClearClick: () => void;
}

let _current: HistoryHeaderScope | null = null;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function getSnapshot() { return _current; }

export function useHistoryHeader(): HistoryHeaderScope | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useRegisterHistoryHeader(scope: HistoryHeaderScope | null) {
  useEffect(() => {
    _current = scope;
    emit();
    return () => {
      if (_current === scope) { _current = null; emit(); }
    };
  }, [scope]);
}
