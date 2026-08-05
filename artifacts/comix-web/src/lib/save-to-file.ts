/**
 * save-to-file.ts
 * Fetches all pages of a chapter via the backend image proxy (to bypass
 * hotlink-protection), bundles them as a ZIP, then triggers a browser download.
 *
 * On desktop/Android → file goes to Downloads folder.
 * On iOS PWA        → blob URL is opened in a new tab (share sheet → Save to Files).
 */
import JSZip from 'jszip';
import { apiUrl } from './api-url';

export interface SaveToFileOptions {
  chapterId: string | number;
  sourceId: string;
  mangaTitle: string;
  chapterLabel: string;
  /** Called with 0–100 as pages are fetched / packed */
  onProgress?: (pct: number) => void;
}

export async function saveChapterToFile(opts: SaveToFileOptions): Promise<void> {
  const { chapterId, sourceId, mangaTitle, chapterLabel, onProgress } = opts;

  // ── 1. Fetch page URL list ────────────────────────────────────────────────
  const pagesRes = await fetch(apiUrl(`/api/chapter/${chapterId}/pages`), {
    headers: { 'x-source': sourceId },
  });
  if (!pagesRes.ok) throw new Error(`Pages request failed: ${pagesRes.status}`);

  const raw      = await pagesRes.json();
  const pageUrls: string[] = Array.isArray(raw) ? raw : (raw.pages ?? raw.data ?? []);
  if (pageUrls.length === 0) throw new Error('No pages found for this chapter');

  // ── 2. Create ZIP ─────────────────────────────────────────────────────────
  const zip        = new JSZip();
  const folderName = sanitize(`${mangaTitle} - ${chapterLabel}`);
  const folder     = zip.folder(folderName)!;

  // ── 3. Fetch each page via the backend image proxy ────────────────────────
  // Direct CDN fetches get 403 (hotlink protected). Routing through /api/image
  // lets the server add the correct Referer / headers.
  const CONCURRENT = 3;
  let fetched = 0;

  for (let i = 0; i < pageUrls.length; i += CONCURRENT) {
    const chunk = pageUrls.slice(i, i + CONCURRENT);

    await Promise.all(
      chunk.map(async (rawUrl, offset) => {
        const proxiedUrl = buildProxiedUrl(rawUrl, sourceId);
        try {
          const res = await fetch(proxiedUrl);
          if (!res.ok) return;
          const blob = await res.blob();
          const ext  = guessExt(rawUrl, res.headers.get('content-type'));
          const name = `page-${String(i + offset + 1).padStart(3, '0')}.${ext}`;
          folder.file(name, blob);
        } catch {
          // Skip failed images rather than aborting the whole ZIP
        }
      }),
    );

    fetched = Math.min(i + CONCURRENT, pageUrls.length);
    // Progress 0–80 while fetching pages; 80–100 reserved for ZIP generation
    onProgress?.(Math.round((fetched / pageUrls.length) * 80));
  }

  // ── 4. Generate ZIP blob ──────────────────────────────────────────────────
  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' }, // STORE = no recompression (images already compressed)
    meta => onProgress?.(80 + Math.round(meta.percent * 0.2)),
  );

  // ── 5. Trigger download ───────────────────────────────────────────────────
  const objectUrl  = URL.createObjectURL(zipBlob);
  const fileName   = `${sanitize(`${mangaTitle} - ${chapterLabel}`)}.zip`;

  // iOS PWA / Safari: <a download> is silently ignored.
  // Opening the blob URL in a new tab shows a preview with a share sheet
  // where the user can "Save to Files".
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIos) {
    window.open(objectUrl, '_blank');
    // Revoke after a delay so the tab can read the blob
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } else {
    const a      = document.createElement('a');
    a.href       = objectUrl;
    a.download   = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Route a raw CDN image URL through the backend proxy so hotlink-protection
 * headers are set server-side. Already-local paths are left as-is.
 */
function buildProxiedUrl(rawUrl: string, sourceId: string): string {
  if (!rawUrl) return rawUrl;
  if (rawUrl.startsWith('/api/') || rawUrl.startsWith('/public/')) {
    return apiUrl(rawUrl);
  }
  return apiUrl(`/api/image?url=${encodeURIComponent(rawUrl)}&source=${encodeURIComponent(sourceId)}`);
}

function sanitize(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function guessExt(url: string, contentType: string | null): string {
  const fromUrl = url.match(/\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i)?.[1]?.toLowerCase();
  if (fromUrl) return fromUrl;
  const mime: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png',
    'image/gif': 'gif',  'image/webp': 'webp', 'image/avif': 'avif',
  };
  return mime[contentType ?? ''] ?? 'jpg';
}
