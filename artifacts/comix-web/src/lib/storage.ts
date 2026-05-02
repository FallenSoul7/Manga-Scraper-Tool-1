import { useSyncExternalStore } from 'react';
import { z } from 'zod';

// --- Schemas ---

const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number(),
});
export type Category = z.infer<typeof CategorySchema>;

const PendingChapterSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  date: z.number(),
});
export type PendingChapter = z.infer<typeof PendingChapterSchema>;

const SavedMangaSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnail: z.string(),
  type: z.string().optional(),
  isNsfw: z.boolean().optional(),
  author: z.string().optional(),
  status: z.string().optional(),
  sourceId: z.string().optional(),
  addedAt: z.number(),
  categoryIds: z.array(z.string()),
  lastChapterCountSeen: z.number(),
  pendingUpdates: z.array(PendingChapterSchema).default([]),
});
export type SavedManga = z.infer<typeof SavedMangaSchema>;

const ChapterProgressSchema = z.object({
  mangaId: z.string(),
  chapterId: z.number(),
  chapterNumber: z.number(),
  chapterTitle: z.string(),
  mangaTitle: z.string(),
  mangaThumbnail: z.string(),
  totalPages: z.number(),
  lastPageRead: z.number(),
  isRead: z.boolean(),
  updatedAt: z.number(),
});
export type ChapterProgress = z.infer<typeof ChapterProgressSchema>;

const ReaderDirectionSchema = z.enum(['vertical', 'ltr', 'rtl', 'webtoon']);
export type ReaderDirection = z.infer<typeof ReaderDirectionSchema>;

const ReaderFitSchema = z.enum(['width', 'height', 'original']);
export type ReaderFit = z.infer<typeof ReaderFitSchema>;

const ReaderBackgroundSchema = z.enum(['paper', 'black', 'gray']);
export type ReaderBackground = z.infer<typeof ReaderBackgroundSchema>;

const ReaderSettingsSchema = z.object({
  direction: ReaderDirectionSchema.default('webtoon'),
  fit: ReaderFitSchema.default('width'),
  background: ReaderBackgroundSchema.default('paper'),
  showPageNumber: z.boolean().default(true),
  keepScreenOn: z.boolean().default(false),
});
export type ReaderSettings = z.infer<typeof ReaderSettingsSchema>;

const ThemeSchema = z.enum([
  'light',
  'dark',
  'system',
  'neon-green',
  'orange',
  'blue',
  'emerald',
]);
export type Theme = z.infer<typeof ThemeSchema>;

/** Themes that are visually dark — used to also toggle the `.dark` class so
 *  shadcn primitives keyed off it pick the right palette. */
const DARK_THEMES: ReadonlySet<Theme> = new Set(['dark', 'neon-green', 'orange', 'blue', 'emerald']);

export interface ThemeOption {
  id: Theme;
  label: string;
  /** A vivid swatch used in the picker. */
  swatch: string;
  /** Smaller secondary swatch shown alongside it (background hint). */
  bg: string;
  isDark: boolean;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'light',      label: 'Light',      swatch: '#9b5b3f', bg: '#f5efe6', isDark: false },
  { id: 'dark',       label: 'Dark',       swatch: '#c98a6c', bg: '#211c19', isDark: true  },
  { id: 'system',     label: 'System',     swatch: '#888888', bg: '#dddddd', isDark: false },
  { id: 'neon-green', label: 'Neon Green', swatch: '#39ff14', bg: '#06140a', isDark: true  },
  { id: 'orange',     label: 'Orange',     swatch: '#ff8a1a', bg: '#1a120a', isDark: true  },
  { id: 'blue',       label: 'Blue',       swatch: '#3b82f6', bg: '#0a1326', isDark: true  },
  { id: 'emerald',    label: 'Emerald',    swatch: '#10b981', bg: '#06170f', isDark: true  },
];

const InstalledSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  lang: z.string(),
  isNsfw: z.boolean(),
  iconUrl: z.string().nullable(),
  installedAt: z.number(),
  isPinned: z.boolean().optional().default(false),
});
export type InstalledSource = z.infer<typeof InstalledSourceSchema>;

export const DEFAULT_SOURCE: InstalledSource = {
  id: 'en.comix',
  name: 'Comix',
  lang: 'en',
  isNsfw: false,
  iconUrl: null,
  installedAt: 0,
  isPinned: false,
};

const StoreStateSchema = z.object({
  library: z.record(z.string(), SavedMangaSchema),
  categories: z.array(CategorySchema),
  progress: z.record(z.string(), ChapterProgressSchema),
  history: z.array(z.string()),
  reader: ReaderSettingsSchema,
  theme: ThemeSchema,
  searchHistory: z.array(z.string()),
  scanlatorPrefs: z.record(z.string(), z.string().nullable()).default({}),
  chapterSortAsc: z.record(z.string(), z.boolean()).default({}),
  installedSources: z.record(z.string(), InstalledSourceSchema).default({ [DEFAULT_SOURCE.id]: DEFAULT_SOURCE }),
  activeSourceId: z.string().default(DEFAULT_SOURCE.id),
  // Real, tracked time spent on the reader page (in milliseconds). The reader
  // adds to this every few seconds while the page is visible.
  readingTimeMs: z.number().default(0),
});
export type StoreState = z.infer<typeof StoreStateSchema>;

// --- Defaults ---

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'default', name: 'Default', order: 0 }
];

const DEFAULT_STATE: StoreState = {
  library: {},
  categories: DEFAULT_CATEGORIES,
  progress: {},
  history: [],
  reader: {
    direction: 'webtoon',
    fit: 'width',
    background: 'paper',
    showPageNumber: true,
    keepScreenOn: false,
  },
  theme: 'system',
  searchHistory: [],
  scanlatorPrefs: {},
  chapterSortAsc: {},
  installedSources: { [DEFAULT_SOURCE.id]: DEFAULT_SOURCE },
  activeSourceId: DEFAULT_SOURCE.id,
  readingTimeMs: 0,
};

// --- Store Implementation ---

const STORE_KEY = 'comix-lounge:v1';
let memoryState: StoreState = DEFAULT_STATE;
const subscribers = new Set<() => void>();

function loadState(): StoreState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    // Backfill any missing top-level fields so older snapshots don't fail validation
    const merged = { ...DEFAULT_STATE, ...parsed };
    const validated = StoreStateSchema.safeParse(merged);
    if (validated.success) {
      if (!validated.data.categories.find(c => c.id === 'default')) {
        validated.data.categories = [...DEFAULT_CATEGORIES, ...validated.data.categories];
      }
      // Always make sure the default Comix source is installed and up-to-date
      const existingDefault = validated.data.installedSources[DEFAULT_SOURCE.id];
      if (!existingDefault) {
        validated.data.installedSources[DEFAULT_SOURCE.id] = DEFAULT_SOURCE;
      } else if (existingDefault.isNsfw !== DEFAULT_SOURCE.isNsfw) {
        // Reconcile metadata fixes (e.g. NSFW flag corrections)
        validated.data.installedSources[DEFAULT_SOURCE.id] = {
          ...existingDefault,
          isNsfw: DEFAULT_SOURCE.isNsfw,
        };
      }
      // Make sure activeSourceId points at an installed source
      if (!validated.data.installedSources[validated.data.activeSourceId]) {
        validated.data.activeSourceId = DEFAULT_SOURCE.id;
      }
      return validated.data;
    }
    console.warn("Store parse error, falling back to defaults", validated.error);
    return DEFAULT_STATE;
  } catch (e) {
    return DEFAULT_STATE;
  }
}

function saveState(state: StoreState) {
  memoryState = state;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save to localStorage", e);
  }
  notify();
  applyTheme(state.theme);
}

function notify() {
  subscribers.forEach(cb => cb());
}

memoryState = loadState();

window.addEventListener('storage', (e) => {
  if (e.key === STORE_KEY) {
    memoryState = loadState();
    notify();
    applyTheme(memoryState.theme);
  }
});

// Theme application
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark =
    DARK_THEMES.has(theme) ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  root.classList.toggle('dark', isDark);
  // Drive the named color-themes from a single attribute so each one can
  // declare its full palette in CSS without exploding the class list.
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

// Initial theme application
if (typeof window !== 'undefined') {
  applyTheme(memoryState.theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (memoryState.theme === 'system') applyTheme('system');
  });
}

// --- Hooks ---

export function useStore<T>(selector: (state: StoreState) => T): T {
  const getSnapshot = () => memoryState;
  const state = useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getSnapshot,
    getSnapshot // Server snapshot
  );
  return selector(state);
}

// --- Actions ---

export const storeActions = {
  addToLibrary(manga: SavedManga) {
    saveState({
      ...memoryState,
      library: {
        ...memoryState.library,
        [manga.id]: manga
      }
    });
  },
  
  removeFromLibrary(mangaId: string) {
    const newLib = { ...memoryState.library };
    delete newLib[mangaId];
    saveState({ ...memoryState, library: newLib });
  },
  
  isInLibrary(mangaId: string): boolean {
    return !!memoryState.library[mangaId];
  },
  
  setMangaCategories(mangaId: string, categoryIds: string[]) {
    const manga = memoryState.library[mangaId];
    if (!manga) return;
    saveState({
      ...memoryState,
      library: {
        ...memoryState.library,
        [mangaId]: { ...manga, categoryIds }
      }
    });
  },
  
  markChaptersSeen(mangaId: string, totalChapterCount: number) {
    const manga = memoryState.library[mangaId];
    if (!manga) return;
    saveState({
      ...memoryState,
      library: {
        ...memoryState.library,
        [mangaId]: { ...manga, lastChapterCountSeen: totalChapterCount, pendingUpdates: [] }
      }
    });
  },

  recordDiscoveredUpdates(mangaId: string, newChapters: PendingChapter[], totalCount: number) {
    const manga = memoryState.library[mangaId];
    if (!manga) return;
    const existingIds = new Set((manga.pendingUpdates ?? []).map(c => c.id));
    const merged = [
      ...(manga.pendingUpdates ?? []),
      ...newChapters.filter(c => !existingIds.has(c.id)),
    ];
    saveState({
      ...memoryState,
      library: {
        ...memoryState.library,
        [mangaId]: { ...manga, lastChapterCountSeen: totalCount, pendingUpdates: merged }
      }
    });
  },

  clearPendingUpdates(mangaId: string) {
    const manga = memoryState.library[mangaId];
    if (!manga) return;
    saveState({
      ...memoryState,
      library: {
        ...memoryState.library,
        [mangaId]: { ...manga, pendingUpdates: [] }
      }
    });
  },

  clearAllPendingUpdates() {
    const newLib = { ...memoryState.library };
    for (const id in newLib) {
      newLib[id] = { ...newLib[id], pendingUpdates: [] };
    }
    saveState({ ...memoryState, library: newLib });
  },

  addCategory(name: string): Category {
    const id = Math.random().toString(36).substring(2, 9);
    const newCat: Category = { id, name, order: memoryState.categories.length };
    saveState({
      ...memoryState,
      categories: [...memoryState.categories, newCat]
    });
    return newCat;
  },
  
  renameCategory(id: string, name: string) {
    if (id === 'default') return;
    saveState({
      ...memoryState,
      categories: memoryState.categories.map(c => c.id === id ? { ...c, name } : c)
    });
  },
  
  removeCategory(id: string) {
    if (id === 'default') return;
    const newLib = { ...memoryState.library };
    for (const mId in newLib) {
      if (newLib[mId].categoryIds.includes(id)) {
        newLib[mId].categoryIds = newLib[mId].categoryIds.filter(c => c !== id);
      }
    }
    saveState({
      ...memoryState,
      library: newLib,
      categories: memoryState.categories.filter(c => c.id !== id)
    });
  },
  
  // Batch-patch any fields on multiple library entries in a single state write.
  batchPatchLibrary(patches: Array<{ mangaId: string; patch: Partial<Pick<SavedManga, 'categoryIds' | 'sourceId'>> }>) {
    const newLib = { ...memoryState.library };
    for (const { mangaId, patch } of patches) {
      if (newLib[mangaId]) newLib[mangaId] = { ...newLib[mangaId], ...patch };
    }
    saveState({ ...memoryState, library: newLib });
  },

  reorderCategories(orderedIds: string[]) {
    const cats = [...memoryState.categories];
    cats.sort((a, b) => {
      const aIdx = orderedIds.indexOf(a.id);
      const bIdx = orderedIds.indexOf(b.id);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
    // Update order prop
    cats.forEach((c, i) => c.order = i);
    saveState({ ...memoryState, categories: cats });
  },

  recordProgress(p: Omit<ChapterProgress, 'updatedAt'>) {
    const key = `${p.mangaId}:${p.chapterId}`;
    const now = Date.now();
    const newProgress = { ...p, updatedAt: now };
    
    let newHistory = memoryState.history.filter(k => k !== key);
    newHistory.unshift(key);
    
    // Trim history to 200
    if (newHistory.length > 200) {
      newHistory = newHistory.slice(0, 200);
    }
    
    // Clean up progress not in history to save space
    const progressMap = { ...memoryState.progress, [key]: newProgress };
    for (const k in progressMap) {
      if (!newHistory.includes(k) && progressMap[k].isRead) {
        // keep unread? or just remove everything not in history?
        // history holds 200 items. Let's keep read states even if not in history so we know what's read.
        // So we won't trim progress map aggressively unless needed, but actually we should keep progress to know read chapters.
      }
    }

    saveState({
      ...memoryState,
      progress: progressMap,
      history: newHistory
    });
  },

  markChapterRead(mangaId: string, chapter: { id:number; number:number; title:string }, manga: { title:string; thumbnail:string }, totalPages: number = 0) {
    this.recordProgress({
      mangaId,
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      mangaTitle: manga.title,
      mangaThumbnail: manga.thumbnail,
      totalPages,
      lastPageRead: Math.max(0, totalPages - 1),
      isRead: true
    });
  },
  
  markChapterUnread(mangaId: string, chapterId: number) {
    const key = `${mangaId}:${chapterId}`;
    const newProgress = { ...memoryState.progress };
    delete newProgress[key];
    const newHistory = memoryState.history.filter(k => k !== key);
    saveState({ ...memoryState, progress: newProgress, history: newHistory });
  },

  markAllChaptersRead(mangaId: string, chapters: Array<{id:number; number:number; title:string}>, manga: {title:string; thumbnail:string}) {
    const newProgress = { ...memoryState.progress };
    let newHistory = [...memoryState.history];
    const now = Date.now();
    
    for (const ch of chapters) {
      const key = `${mangaId}:${ch.id}`;
      if (!newProgress[key]?.isRead) {
        newProgress[key] = {
          mangaId,
          chapterId: ch.id,
          chapterNumber: ch.number,
          chapterTitle: ch.title,
          mangaTitle: manga.title,
          mangaThumbnail: manga.thumbnail,
          totalPages: 0,
          lastPageRead: 0,
          isRead: true,
          updatedAt: now
        };
        newHistory = newHistory.filter(k => k !== key);
        newHistory.unshift(key);
      }
    }
    if (newHistory.length > 200) newHistory = newHistory.slice(0, 200);
    saveState({ ...memoryState, progress: newProgress, history: newHistory });
  },
  
  markAllChaptersUnread(mangaId: string) {
    const newProgress = { ...memoryState.progress };
    for (const k in newProgress) {
      if (newProgress[k].mangaId === mangaId) {
        delete newProgress[k];
      }
    }
    const newHistory = memoryState.history.filter(k => !k.startsWith(`${mangaId}:`));
    saveState({ ...memoryState, progress: newProgress, history: newHistory });
  },

  removeFromHistory(mangaId: string, chapterId: number) {
    const key = `${mangaId}:${chapterId}`;
    const newHistory = memoryState.history.filter(k => k !== key);
    saveState({ ...memoryState, history: newHistory });
  },

  clearHistory() {
    saveState({ ...memoryState, history: [] });
  },

  clearHistoryBefore(cutoffMs: number) {
    const newHistory = memoryState.history.filter(k => {
      const p = memoryState.progress[k];
      return p ? p.updatedAt < cutoffMs : false;
    });
    saveState({ ...memoryState, history: newHistory });
  },

  togglePinSource(id: string) {
    const existing = memoryState.installedSources[id];
    if (!existing) return;
    const updated = { ...existing, isPinned: !existing.isPinned };
    saveState({ ...memoryState, installedSources: { ...memoryState.installedSources, [id]: updated } });
  },

  setReader(updates: Partial<ReaderSettings>) {
    saveState({
      ...memoryState,
      reader: { ...memoryState.reader, ...updates }
    });
  },
  
  setTheme(theme: Theme) {
    saveState({ ...memoryState, theme });
  },

  setScanlatorPref(mangaId: string, scanlator: string | null) {
    saveState({
      ...memoryState,
      scanlatorPrefs: { ...memoryState.scanlatorPrefs, [mangaId]: scanlator }
    });
  },
  
  setChapterSortAsc(mangaId: string, asc: boolean) {
    saveState({
      ...memoryState,
      chapterSortAsc: { ...memoryState.chapterSortAsc, [mangaId]: asc }
    });
  },

  pushSearch(q: string) {
    if (!q.trim()) return;
    let newH = memoryState.searchHistory.filter(x => x.toLowerCase() !== q.toLowerCase());
    newH.unshift(q);
    if (newH.length > 20) newH = newH.slice(0, 20);
    saveState({ ...memoryState, searchHistory: newH });
  },
  
  clearSearchHistory() {
    saveState({ ...memoryState, searchHistory: [] });
  },

  /** Add tracked reading time. Called periodically by the reader. */
  addReadingTime(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    saveState({ ...memoryState, readingTimeMs: (memoryState.readingTimeMs ?? 0) + ms });
  },

  exportBackup(): string {
    return JSON.stringify(memoryState);
  },
  
  importBackup(json: string): { ok: boolean; error?: string } {
    try {
      const parsed = JSON.parse(json);
      const validated = StoreStateSchema.safeParse(parsed);
      if (validated.success) {
        saveState(validated.data);
        return { ok: true };
      } else {
        return { ok: false, error: "Invalid backup format" };
      }
    } catch (e: any) {
      return { ok: false, error: e.message || "Failed to parse JSON" };
    }
  },
  
  resetAll() {
    saveState(DEFAULT_STATE);
  },

  installSource(source: Omit<InstalledSource, 'installedAt'>) {
    if (memoryState.installedSources[source.id]) return;
    saveState({
      ...memoryState,
      installedSources: {
        ...memoryState.installedSources,
        [source.id]: { ...source, installedAt: Date.now() },
      },
    });
  },

  uninstallSource(id: string) {
    if (id === DEFAULT_SOURCE.id) return; // never remove default
    if (!memoryState.installedSources[id]) return;
    const next = { ...memoryState.installedSources };
    delete next[id];
    const newActive =
      memoryState.activeSourceId === id ? DEFAULT_SOURCE.id : memoryState.activeSourceId;
    saveState({ ...memoryState, installedSources: next, activeSourceId: newActive });
  },

  setActiveSource(id: string) {
    if (!memoryState.installedSources[id]) return;
    if (memoryState.activeSourceId === id) return;
    saveState({ ...memoryState, activeSourceId: id });
  },
};
