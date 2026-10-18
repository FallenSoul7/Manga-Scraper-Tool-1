import { useState, useEffect } from 'react';

export enum GetPopularPoster {
  small = 'small',
  medium = 'medium',
  large = 'large',
}

export enum GetMangaDetailsScore {
  top = 'top',
  bottom = 'bottom',
  hidden = 'hidden',
}

export interface Settings {
  hideNsfw: boolean;
  /** Per-extension override. Unset sources inherit the global default. */
  sourceHideNsfw: Record<string, boolean>;
  posterQuality: GetPopularPoster;
  dedupeChapters: boolean;
  showAltNames: boolean;
  scorePosition: GetMangaDetailsScore;
  showNsfwBadge: boolean;
}

const defaultSettings: Settings = {
  hideNsfw: true,
  sourceHideNsfw: {},
  posterQuality: GetPopularPoster.large,
  dedupeChapters: true,
  showAltNames: true,
  scorePosition: GetMangaDetailsScore.top,
  showNsfwBadge: false,
};

// Only show a per-extension mature-content control where the source can
// actually return mixed mature and non-mature results. Adult-only sources are
// already protected by the global age gate and do not need a redundant toggle.
const MATURE_FILTER_SOURCES = new Set([
  'en.comix', 'all.mangadex', 'all.atsu', 'en.allmanga', 'builtin.universal',
]);
export function sourceSupportsMatureFilter(sourceId: string, isNsfw = false): boolean {
  return !isNsfw && MATURE_FILTER_SOURCES.has(sourceId);
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('comix-settings');
    if (saved) {
      try {
        return { ...defaultSettings, ...JSON.parse(saved) };
      } catch (e) {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem('comix-settings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (updates: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  };

  const hideNsfwForSource = (sourceId: string) =>
    settings.sourceHideNsfw[sourceId] ?? settings.hideNsfw;
  const setHideNsfwForSource = (sourceId: string, hide: boolean) => {
    updateSettings({
      sourceHideNsfw: { ...settings.sourceHideNsfw, [sourceId]: hide },
    });
  };

  return { settings, updateSettings, hideNsfwForSource, setHideNsfwForSource };
}
