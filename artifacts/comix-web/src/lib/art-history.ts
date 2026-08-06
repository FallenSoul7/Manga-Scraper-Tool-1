// art-history.ts — localStorage-based art history (last 5 items)

const STORAGE_KEY = "comix-art-history";
const MAX_ITEMS = 5;

export interface ArtHistoryItem {
  id: string;
  type: "draw" | "animate";
  prompt: string;
  imageUrl: string;
  animationType?: string;
  direction?: string;
  speed?: string;
  bgColor?: string;
  createdAt: number;
}

export function getHistory(): ArtHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ArtHistoryItem[];
  } catch {
    return [];
  }
}

export function addToHistory(item: ArtHistoryItem): ArtHistoryItem[] {
  const current = getHistory();
  // Put newest first, deduplicate by id
  const next = [item, ...current.filter((h) => h.id !== item.id)].slice(
    0,
    MAX_ITEMS
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded — trim and retry
    const trimmed = next.slice(0, 3);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Give up silently
    }
    return trimmed;
  }
  return next;
}

export function deleteFromHistory(id: string): ArtHistoryItem[] {
  const next = getHistory().filter((h) => h.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    //
  }
  return next;
}
