import { useSyncExternalStore } from 'react';

export interface QueueItem {
  id: string;
  mangaId: string;
  mangaTitle: string;
  mangaThumbnail: string;
  sourceId?: string;
  chapterId: number;
  chapterNumber: number;
  chapterTitle: string;
  progress: number;
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error';
}

interface QueueState {
  items: QueueItem[];
  paused: boolean;
  concurrentCount: number;
}

let state: QueueState = {
  items: [],
  paused: false,
  concurrentCount: 1,
};

const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach(cb => cb());
}

function getSnapshot(): QueueState {
  return state;
}

export function useDownloadQueue<T>(selector: (s: QueueState) => T): T {
  return useSyncExternalStore(
    cb => { subscribers.add(cb); return () => subscribers.delete(cb); },
    () => selector(getSnapshot()),
    () => selector(getSnapshot()),
  );
}

let tickInterval: ReturnType<typeof setInterval> | null = null;

function ensureTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    if (state.paused) return;

    const downloading = state.items.filter(i => i.status === 'downloading');
    const queued      = state.items.filter(i => i.status === 'queued');

    // Promote queued → downloading up to concurrentCount
    if (downloading.length < state.concurrentCount && queued.length > 0) {
      const toStart = queued.slice(0, state.concurrentCount - downloading.length);
      const startIds = new Set(toStart.map(s => s.id));
      state = {
        ...state,
        items: state.items.map(item =>
          startIds.has(item.id) ? { ...item, status: 'downloading' } : item
        ),
      };
    }

    // Tick progress for each downloading item
    let changed = false;
    const newItems = state.items.map(item => {
      if (item.status !== 'downloading') return item;
      const inc = 3 + Math.random() * 8;
      const next = Math.min(100, item.progress + inc);
      changed = true;
      if (next >= 100) {
        // Lazily import storeActions to avoid circular dep at module load time
        import('./storage').then(({ storeActions }) => {
          storeActions.markMangaDownloaded(item.mangaId);
        });
        return { ...item, progress: 100, status: 'done' as const };
      }
      return { ...item, progress: next };
    });

    if (changed) {
      state = { ...state, items: newItems };
      notify();
    }

    // Stop tick when nothing active remains
    const active = state.items.filter(i => i.status === 'downloading' || i.status === 'queued').length;
    if (active === 0 && tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }, 400);
}

export const queueActions = {
  enqueue(item: Omit<QueueItem, 'id' | 'progress' | 'status'>) {
    const newItem: QueueItem = {
      ...item,
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      progress: 0,
      status: 'queued',
    };
    state = { ...state, items: [...state.items, newItem] };
    notify();
    if (!state.paused) ensureTick();
  },

  enqueueMany(items: Omit<QueueItem, 'id' | 'progress' | 'status'>[]) {
    const newItems: QueueItem[] = items.map(item => ({
      ...item,
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      progress: 0,
      status: 'queued' as const,
    }));
    state = { ...state, items: [...state.items, ...newItems] };
    notify();
    if (!state.paused) ensureTick();
  },

  remove(id: string) {
    state = { ...state, items: state.items.filter(i => i.id !== id) };
    notify();
  },

  clearDone() {
    state = { ...state, items: state.items.filter(i => i.status !== 'done') };
    notify();
  },

  moveUp(id: string) {
    const items = [...state.items];
    const idx = items.findIndex(i => i.id === id);
    if (idx <= 0) return;
    let prevIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (items[i].status === 'queued' || items[i].status === 'downloading') {
        prevIdx = i;
        break;
      }
    }
    if (prevIdx === -1) return;
    [items[prevIdx], items[idx]] = [items[idx], items[prevIdx]];
    state = { ...state, items };
    notify();
  },

  moveDown(id: string) {
    const items = [...state.items];
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0 || idx >= items.length - 1) return;
    let nextIdx = -1;
    for (let i = idx + 1; i < items.length; i++) {
      if (items[i].status === 'queued' || items[i].status === 'downloading') {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx === -1) return;
    [items[nextIdx], items[idx]] = [items[idx], items[nextIdx]];
    state = { ...state, items };
    notify();
  },

  togglePause() {
    state = { ...state, paused: !state.paused };
    notify();
    if (!state.paused) ensureTick();
  },

  setConcurrent(n: number) {
    state = { ...state, concurrentCount: Math.max(1, Math.min(5, n)) };
    notify();
    if (!state.paused) ensureTick();
  },
};
