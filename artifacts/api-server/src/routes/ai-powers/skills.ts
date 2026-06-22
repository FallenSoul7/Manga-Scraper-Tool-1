// ai-powers/skills.ts
import type { SkillFunction, SkillResult } from './types';

// ────────────────────────────────────────────────────────────────
// 1. DISCOVERY & SEARCH
// ────────────────────────────────────────────────────────────────

export const listSources: SkillFunction = async (args, ctx) => {
  try {
    const res = await ctx.apiFetch('/api/sources/catalog');
    if (!res.ok) return { result: 'Failed to load sources.' };
    const data = await res.json() as any;
    const supported = (data.extensions ?? []).filter((e: any) => e.supported);
    if (!supported.length) return { result: 'No supported sources found.' };
    const list = supported.map((e: any) =>
      `• ${e.name} (ID: ${e.id}, lang: ${e.lang}${e.isNsfw ? ', 18+' : ''})`
    ).join('\n');
    return { result: `Available sources (${supported.length}):\n${list}` };
  } catch {
    return { result: 'Could not fetch sources.' };
  }
};

export const globalSearch: SkillFunction = async (args, ctx) => {
  const { query } = args;
  try {
    const res = await ctx.apiFetch(`/api/sources/search/global?q=${encodeURIComponent(query)}`);
    if (!res.ok) return { result: `Global search failed for "${query}".` };
    const data = await res.json() as any;
    const items: any[] = data.items ?? data.results ?? [];
    if (!items.length) return { result: `No results found for "${query}" across all sources.` };
    const list = items.slice(0, 15).map((m: any) =>
      `• ${m.title}${m.type ? ` [${m.type}]` : ''}${m.source ? ` (${m.source})` : ''}`
    ).join('\n');
    return { result: `Global search results for "${query}":\n${list}` };
  } catch {
    return { result: `Global search failed for "${query}".` };
  }
};

export const searchManga: SkillFunction = async (args, ctx) => {
  const { sourceId, query, page = 1 } = args;
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/search?q=${encodeURIComponent(query)}&page=${page}`);
    if (!res.ok) return { result: `Search failed in ${sourceId}.` };
    const data = await res.json() as any;
    const items: any[] = data.items ?? data.results ?? [];
    if (!items.length) return { result: `No results for "${query}" in ${sourceId}.` };
    const list = items.slice(0, 12).map((m: any) => `• ${m.title}${m.type ? ` [${m.type}]` : ''}`).join('\n');
    return { result: `Search results for "${query}" in ${sourceId}:\n${list}` };
  } catch {
    return { result: `Could not search ${sourceId}.` };
  }
};

export const browsePopular: SkillFunction = async (args, ctx) => {
  const { sourceId, page = 1 } = args;
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/popular?page=${page}`);
    if (!res.ok) return { result: `Could not browse ${sourceId}.` };
    const data = await res.json() as any;
    const items: any[] = data.items ?? data.results ?? [];
    if (!items.length) return { result: 'No results found.' };
    const list = items.slice(0, 12).map((m: any) => `• ${m.title}${m.type ? ` [${m.type}]` : ''}`).join('\n');
    return { result: `Popular in ${sourceId}:\n${list}` };
  } catch {
    return { result: `Could not browse ${sourceId}.` };
  }
};

export const browseLatest: SkillFunction = async (args, ctx) => {
  const { sourceId, page = 1 } = args;
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/latest?page=${page}`);
    if (!res.ok) return { result: `Could not browse latest from ${sourceId}.` };
    const data = await res.json() as any;
    const items: any[] = data.items ?? data.results ?? [];
    if (!items.length) return { result: 'No results found.' };
    const list = items.slice(0, 12).map((m: any) => `• ${m.title}${m.type ? ` [${m.type}]` : ''}`).join('\n');
    return { result: `Latest in ${sourceId}:\n${list}` };
  } catch {
    return { result: `Could not browse latest from ${sourceId}.` };
  }
};

export const browseByTag: SkillFunction = async (args, ctx) => {
  const { sourceId, tagIds, page = 1 } = args;
  // tagIds should be an array of strings like ["6:123"]
  const tagParam = Array.isArray(tagIds) ? tagIds.join(',') : tagIds;
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/tag/${encodeURIComponent(tagParam)}?page=${page}`);
    if (!res.ok) return { result: `Could not browse tag(s) in ${sourceId}.` };
    const data = await res.json() as any;
    const items: any[] = data.items ?? data.results ?? [];
    if (!items.length) return { result: `No results for tag(s) in ${sourceId}.` };
    const list = items.slice(0, 12).map((m: any) => `• ${m.title}${m.type ? ` [${m.type}]` : ''}`).join('\n');
    return { result: `Results for tag(s) in ${sourceId}:\n${list}` };
  } catch {
    return { result: `Could not browse tag(s) in ${sourceId}.` };
  }
};

export const getSourceTags: SkillFunction = async (args, ctx) => {
  const { sourceId } = args;
  if (!sourceId) return { result: 'sourceId is required.' };
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/tags`);
    if (!res.ok) return { result: `Could not fetch tags for ${sourceId}.` };
    const tags = await res.json() as any[];
    if (!tags.length) return { result: `No tags found for ${sourceId}.` };
    const lines = tags.map((t: any) =>
      `• ${t.name} (ID: ${t.id})${t.count ? ` – ${t.count} titles` : ''}`
    ).join('\n');
    return { result: `Tags for ${sourceId}:\n${lines}` };
  } catch {
    return { result: `Could not fetch tags for ${sourceId}.` };
  }
};

export const checkSourceHealth: SkillFunction = async (args, ctx) => {
  const { sourceId } = args;
  if (!sourceId) return { result: 'sourceId is required.' };
  try {
    // Try to fetch popular page (first page) as a health check
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/popular?page=1`);
    if (!res.ok) return { result: `❌ Source "${sourceId}" is DOWN (HTTP ${res.status}).` };
    const data = await res.json() as any;
    const items = data.items ?? data.results ?? [];
    if (items.length === 0) return { result: `⚠️ Source "${sourceId}" is ONLINE but returned no results (may be empty).` };
    return { result: `✅ Source "${sourceId}" is ONLINE and has ${items.length} titles on page 1.` };
  } catch (e: any) {
    return { result: `❌ Source "${sourceId}" is DOWN: ${e.message || 'Unknown error'}.` };
  }
};

export const detectSourceBugs: SkillFunction = async (args, ctx) => {
  const { sourceId } = args;
  // This would inspect error logs or known issues from a registry.
  // For now, we return a generic stub.
  return { result: `No known bugs reported for "${sourceId}".` };
};

// ────────────────────────────────────────────────────────────────
// 2. DEEP DETAIL
// ────────────────────────────────────────────────────────────────

export const getMangaDetails: SkillFunction = async (args, ctx) => {
  const { sourceId, mangaId } = args;
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/manga/${encodeURIComponent(mangaId)}`);
    if (!res.ok) return { result: `Could not fetch details for manga ${mangaId}.` };
    const m = await res.json() as any;
    const genres = m.genres?.join(', ') ?? 'N/A';
    const detail = [
      `**${m.title}**`,
      m.description ? `${m.description.slice(0, 300)}${m.description.length > 300 ? '…' : ''}` : '',
      `Author: ${m.author ?? 'Unknown'}`,
      `Status: ${m.status ?? 'Unknown'}`,
      `Genres: ${genres}`,
      m.chapterCount != null ? `Chapters: ${m.chapterCount}` : '',
    ].filter(Boolean).join('\n');
    return { result: detail };
  } catch {
    return { result: `Could not fetch details for manga ${mangaId}.` };
  }
};

export const getChapters: SkillFunction = async (args, ctx) => {
  const { sourceId, mangaId } = args;
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/manga/${encodeURIComponent(mangaId)}/chapters`);
    if (!res.ok) return { result: `Could not fetch chapters for manga ${mangaId}.` };
    const data = await res.json() as any;
    const chapters: any[] = data.chapters ?? data.items ?? [];
    if (!chapters.length) return { result: 'No chapters found.' };
    const preview = chapters.slice(0, 10).map((c: any) =>
      `• Ch.${c.number ?? '?'} — ${c.title ?? 'Untitled'}${c.uploadDate ? ` (${c.uploadDate})` : ''}`
    ).join('\n');
    const extra = chapters.length > 10 ? `\n…and ${chapters.length - 10} more chapters.` : '';
    return { result: `Chapters (${chapters.length} total):\n${preview}${extra}` };
  } catch {
    return { result: `Could not fetch chapters for manga ${mangaId}.` };
  }
};

export const getMangaByID: SkillFunction = async (args, ctx) => {
  // Similar to getMangaDetails, but returns raw data maybe
  return getMangaDetails(args, ctx);
};

export const getRelatedManga: SkillFunction = async (args, ctx) => {
  // Stub: could use source's "recommendations" if available
  return { result: 'Related manga feature not yet implemented.' };
};

export const getMangaSynopsis: SkillFunction = async (args, ctx) => {
  const { sourceId, mangaId } = args;
  const detailResult = await getMangaDetails({ sourceId, mangaId }, ctx);
  // Try to extract synopsis from detail
  const lines = detailResult.result.split('\n');
  // Usually the synopsis is the second line after title
  return { result: lines[1] || 'No synopsis available.' };
};

export const getMangaTags: SkillFunction = async (args, ctx) => {
  const { sourceId, mangaId } = args;
  const detailResult = await getMangaDetails({ sourceId, mangaId }, ctx);
  // Extract genres from the detail
  const lines = detailResult.result.split('\n');
  const genreLine = lines.find(l => l.startsWith('Genres:'));
  if (genreLine) return { result: genreLine };
  return { result: 'No genre information found.' };
};

// ────────────────────────────────────────────────────────────────
// 3. LIBRARY MANAGEMENT
// ────────────────────────────────────────────────────────────────

export const listCategories: SkillFunction = async (args, ctx) => {
  const categories = ctx.store.categories.sort((a, b) => a.order - b.order);
  const lib = ctx.store.library;
  const lines = categories.map(c => {
    const count = Object.values(lib).filter(m => m.categoryIds.includes(c.id)).length;
    return `• ${c.name} (ID: ${c.id}, ${count} manga)`;
  });
  return { result: `User categories:\n${lines.join('\n')}` };
};

export const listLibrary: SkillFunction = async (args, ctx) => {
  const { categoryId } = args;
  const lib = Object.values(ctx.store.library);
  const filtered = categoryId ? lib.filter(m => m.categoryIds.includes(categoryId)) : lib;
  if (!filtered.length) return { result: 'Library is empty (or no manga in that category).' };
  const lines = filtered.slice(0, 30).map(m =>
    `• ${m.title} (ID: ${m.id}${m.categoryIds.length ? `, cats: ${m.categoryIds.join(',')}` : ''})`
  );
  const extra = filtered.length > 30 ? `\n…and ${filtered.length - 30} more.` : '';
  return { result: `Library (${filtered.length} manga):\n${lines.join('\n')}${extra}` };
};

export const addToLibrary: SkillFunction = async (args, ctx) => {
  const { sourceId, mangaId, categoryId } = args;
  try {
    const res = await ctx.apiFetch('/api/library/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, mangaId, categoryId }),
    });
    if (!res.ok) return { result: `Failed to add manga to library.` };
    const data = await res.json() as any;
    return { result: `Added "${data.title ?? mangaId}" to library${categoryId ? ` in category ${categoryId}` : ''}.` };
  } catch {
    return { result: `Could not add manga to library.` };
  }
};

export const removeFromLibrary: SkillFunction = async (args, ctx) => {
  const { mangaId } = args;
  // Assume there is an endpoint; if not, use store actions
  if (ctx.actions.removeFromLibrary) {
    ctx.actions.removeFromLibrary(mangaId);
    return { result: `Removed manga ${mangaId} from library.` };
  }
  return { result: 'removeFromLibrary not implemented in storage.' };
};

export const createCategory: SkillFunction = async (args, ctx) => {
  const { name } = args;
  if (!name?.trim()) return { result: 'Category name cannot be empty.' };
  const existing = ctx.store.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return { result: `Category "${name}" already exists (ID: ${existing.id}).` };
  const cat = ctx.actions.addCategory(name.trim());
  return { result: `Created category "${cat.name}" (ID: ${cat.id}).` };
};

export const deleteCategory: SkillFunction = async (args, ctx) => {
  const { categoryId, categoryName } = args;
  if (categoryId === 'default') return { result: 'Cannot delete the Default category.' };
  const cat = ctx.store.categories.find(c => c.id === categoryId);
  if (!cat) return { result: `Category "${categoryName}" not found.` };
  const count = Object.values(ctx.store.library).filter(m => m.categoryIds.includes(categoryId)).length;
  const desc = `Delete category **"${cat.name}"**${count > 0 ? ` — ${count} manga will be moved to Default` : ' (empty category)'}.`;
  return {
    result: `PERMISSION_REQUIRED to delete "${cat.name}". Waiting for user confirmation.`,
    permissionRequest: {
      description: desc,
      execute: () => {
        ctx.actions.removeCategory(categoryId);
        return `Deleted category "${cat.name}".${count > 0 ? ` ${count} manga moved to Default.` : ''}`;
      },
    },
  };
};

export const renameCategory: SkillFunction = async (args, ctx) => {
  const { categoryId, newName } = args;
  if (!newName?.trim()) return { result: 'New name cannot be empty.' };
  const cat = ctx.store.categories.find(c => c.id === categoryId);
  if (!cat) return { result: `Category ${categoryId} not found.` };
  if (ctx.actions.renameCategory) {
    ctx.actions.renameCategory(categoryId, newName.trim());
    return { result: `Renamed category to "${newName.trim()}".` };
  }
  return { result: 'renameCategory not implemented in storage.' };
};

export const moveMangaCategory: SkillFunction = async (args, ctx) => {
  const { mangaId, targetCategoryId } = args;
  const manga = ctx.store.library[mangaId];
  if (!manga) return { result: `Manga ID "${mangaId}" not found in library.` };
  const cat = ctx.store.categories.find(c => c.id === targetCategoryId);
  if (!cat) return { result: `Category ID "${targetCategoryId}" not found.` };
  ctx.actions.setMangaCategories(mangaId, [targetCategoryId]);
  return { result: `Moved "${manga.title}" to category "${cat.name}".` };
};

export const batchAddToLibrary: SkillFunction = async (args, ctx) => {
  const { items } = args; // items = [{ sourceId, mangaId, categoryId? }]
  if (!Array.isArray(items) || !items.length) return { result: 'No items provided.' };
  let added = 0;
  for (const item of items) {
    const res = await addToLibrary(item, ctx);
    if (!res.result.startsWith('Added')) continue;
    added++;
  }
  return { result: `Added ${added} manga to library.` };
};

export const batchMoveCategory: SkillFunction = async (args, ctx) => {
  const { mangaIds, targetCategoryId } = args;
  if (!Array.isArray(mangaIds) || !mangaIds.length) return { result: 'No manga IDs provided.' };
  let moved = 0;
  for (const id of mangaIds) {
    const res = await moveMangaCategory({ mangaId: id, targetCategoryId }, ctx);
    if (res.result.includes('Moved')) moved++;
  }
  return { result: `Moved ${moved} manga to category.` };
};

export const getLibraryStats: SkillFunction = async (args, ctx) => {
  const lib = Object.values(ctx.store.library);
  const total = lib.length;
  const cats = ctx.store.categories;
  const perCategory = cats.map(c => {
    const count = lib.filter(m => m.categoryIds.includes(c.id)).length;
    return `${c.name}: ${count}`;
  });
  return { result: `Library stats:\nTotal manga: ${total}\n${perCategory.join('\n')}` };
};

// ────────────────────────────────────────────────────────────────
// 4. WEB & EXTERNAL
// ────────────────────────────────────────────────────────────────

export const webSearch: SkillFunction = async (args, ctx) => {
  const { query } = args;
  // This would call a search API (SerpAPI, Tavily, etc.) via backend
  try {
    const res = await ctx.apiFetch(`/api/search/web?q=${encodeURIComponent(query)}`);
    if (!res.ok) return { result: `Web search failed for "${query}".` };
    const data = await res.json() as any;
    const results = data.results || [];
    if (!results.length) return { result: `No web results for "${query}".` };
    const list = results.slice(0, 5).map((r: any) =>
      `• ${r.title}\n  ${r.snippet}\n  ${r.url}`
    ).join('\n\n');
    return { result: `Web search results for "${query}":\n${list}` };
  } catch {
    return { result: `Web search failed for "${query}".` };
  }
};

export const fetchURL: SkillFunction = async (args, ctx) => {
  const { url } = args;
  try {
    const res = await ctx.apiFetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { result: `Could not fetch ${url}.` };
    const data = await res.json() as any;
    // Return a summary of the page (title, description, etc.)
    return { result: `Fetched ${url}:\nTitle: ${data.title || 'N/A'}\nDescription: ${data.description || 'N/A'}` };
  } catch {
    return { result: `Could not fetch ${url}.` };
  }
};

export const checkWebsiteStatus: SkillFunction = async (args, ctx) => {
  const { url } = args;
  try {
    const res = await ctx.apiFetch(`/api/check-status?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { result: `❌ ${url} is DOWN.` };
    const data = await res.json() as any;
    return { result: `✅ ${url} is ONLINE (status ${data.status}).` };
  } catch {
    return { result: `❌ ${url} is DOWN or unreachable.` };
  }
};

// ────────────────────────────────────────────────────────────────
// 5. VISUAL & PAGE INSPECTION ("EYES")
// ────────────────────────────────────────────────────────────────

export const readCurrentPage: SkillFunction = async (args, ctx) => {
  // This skill relies on the frontend sending page data.
  // The context can contain a `pageData` property injected by the frontend.
  const pageData = ctx.pageData || args.pageData;
  if (!pageData) return { result: 'No page data available. Please open a manga/extension page first.' };
  // pageData = { url, title, description, tags, chapters, imageUrls, ... }
  const info = [
    `Page: ${pageData.url}`,
    `Title: ${pageData.title || 'N/A'}`,
    `Description: ${pageData.description || 'N/A'}`,
    `Tags: ${(pageData.tags || []).join(', ') || 'N/A'}`,
    `Chapters: ${pageData.chapters ? pageData.chapters.length : 'N/A'}`,
    `Image: ${pageData.imageUrl || 'N/A'}`,
  ].join('\n');
  return { result: `Current page content:\n${info}` };
};

export const extractMangaData: SkillFunction = async (args, ctx) => {
  // Similar to readCurrentPage but more structured
  const pageData = ctx.pageData || args.pageData;
  if (!pageData) return { result: 'No page data available.' };
  // Return a structured manga object
  return { result: JSON.stringify(pageData, null, 2) };
};

export const detectPageElements: SkillFunction = async (args, ctx) => {
  // This would be a frontend‑side detection using DOM selectors.
  // For now, return a stub.
  return { result: 'Page element detection requires frontend integration.' };
};

export const screenshotPage: SkillFunction = async (args, ctx) => {
  // Requires backend headless browser or frontend capture.
  // Return a stub.
  return { result: 'Screenshot functionality not yet implemented.' };
};

// ────────────────────────────────────────────────────────────────
// 6. SYSTEM & DIAGNOSTICS
// ────────────────────────────────────────────────────────────────

export const getSystemStatus: SkillFunction = async (args, ctx) => {
  // Check backend health, API keys, database, etc.
  try {
    const res = await ctx.apiFetch('/api/health');
    if (!res.ok) return { result: 'System unhealthy.' };
    const data = await res.json() as any;
    return { result: `System status:\n${JSON.stringify(data, null, 2)}` };
  } catch {
    return { result: 'Could not retrieve system status.' };
  }
};

export const getExtensionLogs: SkillFunction = async (args, ctx) => {
  const { sourceId } = args;
  // Fetch logs from backend for that extension
  try {
    const res = await ctx.apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/logs`);
    if (!res.ok) return { result: `Could not fetch logs for ${sourceId}.` };
    const logs = await res.text();
    return { result: `Logs for ${sourceId}:\n${logs.slice(0, 1000)}` };
  } catch {
    return { result: `Could not fetch logs for ${sourceId}.` };
  }
};

export const reportBug: SkillFunction = async (args, ctx) => {
  const { description, sourceId } = args;
  // Log bug to system
  return { result: `Bug reported for ${sourceId}: ${description}` };
};

export const suggestFix: SkillFunction = async (args, ctx) => {
  const { errorMessage, sourceId } = args;
  // Simple pattern matching
  if (errorMessage.includes('404')) return { result: 'The source may be down. Try checking its health.' };
  if (errorMessage.includes('timeout')) return { result: 'The source is slow. Try again later or use another source.' };
  return { result: 'No specific fix available.' };
};

export const runHealthCheck: SkillFunction = async (args, ctx) => {
  // Run all health checks and return summary
  const sources = await listSources({}, ctx);
  const lines = sources.result.split('\n');
  // For each source, run checkSourceHealth
  const results: string[] = [];
  for (const line of lines) {
    const match = line.match(/ID: ([^,)]+)/);
    if (match) {
      const id = match[1];
      const health = await checkSourceHealth({ sourceId: id }, ctx);
      results.push(health.result);
    }
  }
  return { result: `Health check results:\n${results.join('\n')}` };
};

// ────────────────────────────────────────────────────────────────
// 7. AI & MODEL CONTROL
// ────────────────────────────────────────────────────────────────

let currentModelMode = 'auto'; // Global state (could be stored in context)

export const switchModelMode: SkillFunction = async (args, ctx) => {
  const { mode } = args;
  const allowed = ['auto', 'gemini', 'groq', 'openrouter', 'uncensored'];
  if (!allowed.includes(mode)) return { result: `Invalid mode. Allowed: ${allowed.join(', ')}` };
  currentModelMode = mode;
  return { result: `Switched to model mode: ${mode}.` };
};

export const getModelStatus: SkillFunction = async (args, ctx) => {
  return { result: `Current model mode: ${currentModelMode}` };
};

export const resetConversation: SkillFunction = async (args, ctx) => {
  // Clear context; will be handled by the caller (frontend)
  return { result: 'Conversation reset. Starting fresh.' };
};

// ────────────────────────────────────────────────────────────────
// 8. USER PREFERENCES
// ────────────────────────────────────────────────────────────────

// We'll store preferences in a global object; in a real app, use a DB.
const userPreferences: Record<string, any> = {};

export const getUserPreferences: SkillFunction = async (args, ctx) => {
  return { result: `User preferences:\n${JSON.stringify(userPreferences, null, 2)}` };
};

export const setUserPreference: SkillFunction = async (args, ctx) => {
  const { key, value } = args;
  userPreferences[key] = value;
  return { result: `Set preference "${key}" to "${value}".` };
};

export const clearUserPreferences: SkillFunction = async (args, ctx) => {
  for (const key in userPreferences) delete userPreferences[key];
  return { result: 'All preferences cleared.' };
};

// ────────────────────────────────────────────────────────────────
// 9. BATCH & AUTOMATION
// ────────────────────────────────────────────────────────────────

export const autoTagManga: SkillFunction = async (args, ctx) => {
  // Use AI to assign tags based on manga description
  return { result: 'Auto‑tagging not yet implemented.' };
};

export const batchSortLibrary: SkillFunction = async (args, ctx) => {
  // Uses the existing sort pipeline; this triggers it.
  return { result: 'Batch sorting requires file upload. Please attach a .db or .tmb file and say "sort my library".' };
};

export const scheduleUpdateCheck: SkillFunction = async (args, ctx) => {
  return { result: 'Scheduling not yet implemented.' };
};

export const exportLibrary: SkillFunction = async (args, ctx) => {
  // Generate JSON export
  const lib = Object.values(ctx.store.library);
  return { result: `Library export (${lib.length} manga):\n${JSON.stringify(lib, null, 2)}` };
};

// ────────────────────────────────────────────────────────────────
// REGISTRY
// ────────────────────────────────────────────────────────────────

export const skillRegistry: Record<string, SkillFunction> = {
  // Discovery & Search
  list_sources: listSources,
  global_search: globalSearch,
  search_manga: searchManga,
  browse_popular: browsePopular,
  browse_latest: browseLatest,
  browse_by_tag: browseByTag,
  get_source_tags: getSourceTags,
  check_source_health: checkSourceHealth,
  detect_source_bugs: detectSourceBugs,

  // Deep Detail
  get_manga_details: getMangaDetails,
  get_chapters: getChapters,
  get_manga_by_id: getMangaByID,
  get_related_manga: getRelatedManga,
  get_manga_synopsis: getMangaSynopsis,
  get_manga_tags: getMangaTags,

  // Library Management
  list_categories: listCategories,
  list_library: listLibrary,
  add_to_library: addToLibrary,
  remove_from_library: removeFromLibrary,
  create_category: createCategory,
  delete_category: deleteCategory,
  rename_category: renameCategory,
  move_manga_category: moveMangaCategory,
  batch_add_to_library: batchAddToLibrary,
  batch_move_category: batchMoveCategory,
  get_library_stats: getLibraryStats,

  // Web & External
  web_search: webSearch,
  fetch_url: fetchURL,
  check_website_status: checkWebsiteStatus,

  // Visual & Page Inspection
  read_current_page: readCurrentPage,
  extract_manga_data: extractMangaData,
  detect_page_elements: detectPageElements,
  screenshot_page: screenshotPage,

  // System & Diagnostics
  get_system_status: getSystemStatus,
  get_extension_logs: getExtensionLogs,
  report_bug: reportBug,
  suggest_fix: suggestFix,
  run_health_check: runHealthCheck,

  // AI & Model Control
  switch_model_mode: switchModelMode,
  get_model_status: getModelStatus,
  reset_conversation: resetConversation,

  // User Preferences
  get_user_preferences: getUserPreferences,
  set_user_preference: setUserPreference,
  clear_user_preferences: clearUserPreferences,

  // Batch & Automation
  auto_tag_manga: autoTagManga,
  batch_sort_library: batchSortLibrary,
  schedule_update_check: scheduleUpdateCheck,
  export_library: exportLibrary,
};
