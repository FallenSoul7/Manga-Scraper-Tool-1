import { setExtraHeader } from "@workspace/api-client-react";
import { useStore } from "./storage";

const HEADER_NAME = "X-Source";

let _qcRef: { invalidateQueries: () => void } | null = null;

export function registerQueryClient(qc: { invalidateQueries: () => void }) {
  _qcRef = qc;
}

export function applyActiveSource(id: string) {
  setExtraHeader(HEADER_NAME, id);
  // Bust all in-flight & cached queries so the next render re-fetches
  // against the newly-selected source.
  if (_qcRef) _qcRef.invalidateQueries();
}

export function useActiveSourceId(): string {
  return useStore((s) => s.activeSourceId);
}

export function useActiveSource() {
  return useStore((s) => s.installedSources[s.activeSourceId] ?? null);
}

export function useInstalledSources() {
  return useStore((s) => Object.values(s.installedSources));
}
