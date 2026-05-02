import { useEffect, useState } from "react";

type HistoryScope = {
  onSearchClick: () => void;
  onClearClick: () => void;
};

let _scope: HistoryScope | null = null;
const _listeners = new Set<() => void>();

export function registerHistoryHeader(scope: HistoryScope | null) {
  _scope = scope;
  _listeners.forEach(l => l());
}

export function useHistoryHeader(): HistoryScope | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const update = () => tick(n => n + 1);
    _listeners.add(update);
    return () => { _listeners.delete(update); };
  }, []);
  return _scope;
}
