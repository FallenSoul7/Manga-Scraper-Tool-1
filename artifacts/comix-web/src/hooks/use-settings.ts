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
  posterQuality: GetPopularPoster;
  dedupeChapters: boolean;
  showAltNames: boolean;
  scorePosition: GetMangaDetailsScore;
}

const defaultSettings: Settings = {
  hideNsfw: true,
  posterQuality: GetPopularPoster.large,
  dedupeChapters: true,
  showAltNames: true,
  scorePosition: GetMangaDetailsScore.top,
};

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

  return { settings, updateSettings };
}
