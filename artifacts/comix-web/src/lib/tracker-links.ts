export interface TrackerLink {
  id: 'anilist' | 'myanimelist';
  label: string;
  url: string;
}

/**
 * Tracker integration without requiring ComiHub to store tracker credentials.
 * These links open the tracker search page, where the user can add or update
 * the title in their own account.
 */
export function getTrackerLinks(title: string): TrackerLink[] {
  const query = encodeURIComponent(title.trim());
  if (!query) return [];
  return [
    { id: 'anilist', label: 'AniList', url: `https://anilist.co/search/manga?search=${query}` },
    { id: 'myanimelist', label: 'MyAnimeList', url: `https://myanimelist.net/search/all?q=${query}` },
  ];
}
