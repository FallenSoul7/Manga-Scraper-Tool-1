/**
 * save-to-file.ts
 * Fetches all pages of a chapter and bundles them as a ZIP file that the browser
 * downloads to the device file system (iOS → Files app, Android/Desktop → Downloads).
 */
import JSZip from 'jszip';
import { apiUrl } from './api-url';

export interface SaveToFileOptions {
  chapterId: string | number;
  sourceId: string;
  mangaTitle: string;
  chapterLabel: string;
  /** Called with 0-100 as pages are fetched */
  onProgress?: (pct: number) => void;
}

export async function saveChapterToFile(opts: SaveToFileOptions): Promise<void> {
  const { chapterId, sourceId, mangaTitle, chapterLabel, onProgress } = opts;

  // 1. Fetch page URL list
  const pagesRes = await fetch(apiUrl(`/api/chapter/${chapterId}/pages`), {
    headers: { 'x-source': sourceId },
  });
  if (!pagesRes.ok) throw new Error(`Pages request failed: ${pagesRes.status}`);

  const raw     = await pagesRes.json();
  const pageUrls: string[] = Array.isArray(raw) ? raw : (raw.pages ?? raw.data ?? []);
  if (pageUrls.length === 0) throw new Error('No pages found for this chapter');

  // 2. Create ZIP folder
  const zip        = new JSZip();
  const folderName = sanitize(`${mangaTitle} - ${chapterLabel}`);
  const folder     = zip.folder(folderName)!;

  // 3. Fetch each page image and add to ZIP
  const CONCURRENT = 4;
  let fetched = 0;

  for (let i = 0; i < pageUrls.length; i += CONCURRENT) {
    const chunk = pageUrls.slice(i, i + CONCURRENT);

    await Promise.all(
      chunk.map(async (url, offset) => {
        const fullUrl = url.startsWith('http') ? url : apiUrl(url);
        try {
          const res = await fetch(fullUrl);
          if (!res.ok) return;
          const blob = await res.blob();
          const ext  = guessExt(url, res.headers.get('content-type'));
          const name = `page-${String(i + offset + 1).padStart(3, '0')}.${ext}`;
          folder.file(name, blob);
        } catch {
          // Skip failed images rather than aborting the whole ZIP
        }
      }),
    );

    fetched = Math.min(i + CONCURRENT, pageUrls.length);
    onProgress?.(Math.round((fetched / pageUrls.length) * 100));
  }

  // 4. Generate ZIP blob and trigger browser download
  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' }, // STORE = no recompression (images are already compressed)
    meta => onProgress?.(Math.round(meta.percent)),
  );

  const objectUrl = URL.createObjectURL(zipBlob);
  const a         = document.createElement('a');
  a.href          = objectUrl;
  a.download      = `${sanitize(`${mangaTitle} - ${chapterLabel}`)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // invalid filename chars
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
