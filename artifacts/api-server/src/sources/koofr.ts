/**
 * Koofr personal library source.
 *
 * Structure expected in Koofr:
 *   /manga/
 *     Some Doujin Title.zip          ← single-chapter doujin
 *     Another Series Chapter 1.zip
 *     ...
 *
 * Each zip is treated as one manga with one chapter.
 * Images are extracted atomically to /tmp/koofr-cache/<md5-of-filename>/
 * on first read. Partial/failed extractions are cleaned up so the next
 * request always retries cleanly.
 */

import axios from "axios";
import unzipper from "unzipper";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as nodePath from "path";
import * as crypto from "crypto";
import * as os from "os";
import type {
  MangaSource,
  ListOptions,
  MangaListResponse,
  MangaDetail,
  DetailOptions,
  ChapterListResponse,
  PageListResponse,
  MangaSummary,
  ChapterSummary,
  PageInfo,
} from "./types.js";

// ── Auth ─────────────────────────────────────────────────────────────────────

function basicAuth(): string {
  const email = process.env.KOOFR_EMAIL;
  const pass = process.env.KOOFR_APP_PASSWORD;
  if (!email || !pass) {
    throw new Error(
      "KOOFR_EMAIL and KOOFR_APP_PASSWORD env vars are required but not set."
    );
  }
  return "Basic " + Buffer.from(`${email}:${pass}`).toString("base64");
}

// ── Koofr API helpers ─────────────────────────────────────────────────────────

const KOOFR_API = "https://app.koofr.net/api/v2";
const MANGA_ROOT = "/manga";

interface KoofrFile {
  name: string;
  type: "dir" | "file";
  size?: number;
  modified?: number; // ms epoch
  contentType?: string;
}

async function listFiles(path: string): Promise<KoofrFile[]> {
  const res = await axios.get<{ files: KoofrFile[] }>(
    `${KOOFR_API}/mounts/primary/files/list`,
    {
      params: { path },
      headers: { Authorization: basicAuth() },
      timeout: 20_000,
    }
  );
  return res.data.files ?? [];
}

// ── Local cache helpers ───────────────────────────────────────────────────────

export const CACHE_ROOT = "/tmp/koofr-cache";
// Sentinel file written only after a successful complete extraction
const DONE_SENTINEL = ".done";

/** Stable, filesystem-safe directory name for a given zip filename */
function cacheKey(filename: string): string {
  return crypto.createHash("md5").update(filename).digest("hex");
}

function isImage(name: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif)$/i.test(name);
}

/**
 * Downloads the zip from Koofr and extracts all images atomically into
 * /tmp/koofr-cache/<key>/. Uses a temp directory + rename so callers
 * never see a partially-extracted set. If a previous extraction failed
 * (no .done sentinel), the stale directory is removed and retried.
 *
 * Returns sorted array of extracted image basenames.
 */
async function extractZip(koofrPath: string, key: string): Promise<string[]> {
  const finalDir = nodePath.join(CACHE_ROOT, key);
  const sentinel = nodePath.join(finalDir, DONE_SENTINEL);

  // Happy path: already fully extracted
  if (fs.existsSync(sentinel)) {
    const files = (await fsp.readdir(finalDir))
      .filter(isImage)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (files.length > 0) return files;
    // Sentinel exists but no images — treat as corrupt, fall through to re-extract
    await fsp.rm(finalDir, { recursive: true, force: true });
  } else if (fs.existsSync(finalDir)) {
    // Partial / failed previous attempt — clean up before retrying
    await fsp.rm(finalDir, { recursive: true, force: true });
  }

  // Write to a temp directory first, then atomically rename on success
  const tmpDir = await fsp.mkdtemp(nodePath.join(os.tmpdir(), `koofr-${key}-`));

  try {
    const response = await axios.get(
      `${KOOFR_API}/mounts/primary/files/get`,
      {
        params: { path: koofrPath },
        headers: { Authorization: basicAuth() },
        responseType: "stream",
        timeout: 120_000,
      }
    );

    const imageFiles: string[] = [];
    const writePromises: Promise<void>[] = [];

    await new Promise<void>((resolve, reject) => {
      response.data
        .pipe(unzipper.Parse({ forceStream: true }))
        .on("entry", (entry: unzipper.Entry) => {
          const rawName = nodePath.basename(entry.path);
          if (entry.path.includes("__MACOSX") || !isImage(rawName)) {
            entry.autodrain();
            return;
          }
          const outPath = nodePath.join(tmpDir, rawName);
          const ws = fs.createWriteStream(outPath);
          // Track each write stream to completion so we don't rename prematurely
          const p = new Promise<void>((res2, rej2) => {
            ws.on("finish", res2);
            ws.on("error", rej2);
          });
          entry.pipe(ws);
          writePromises.push(p);
          imageFiles.push(rawName);
        })
        .on("close", () => resolve())
        .on("error", reject);
    });

    // Wait for every file write to fully flush
    await Promise.all(writePromises);

    // Write sentinel to mark extraction as complete
    await fsp.writeFile(nodePath.join(tmpDir, DONE_SENTINEL), "");

    // Promote temp dir to final location atomically
    await fsp.mkdir(CACHE_ROOT, { recursive: true });
    await fsp.rename(tmpDir, finalDir);

    return imageFiles.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  } catch (err) {
    // Clean up temp dir on any failure so the next request starts fresh
    await fsp.rm(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

// ── ID encoding ───────────────────────────────────────────────────────────────

function encId(filename: string): string {
  return Buffer.from(filename).toString("base64url");
}

function decId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf-8");
}

function zipTitle(filename: string): string {
  try {
    return decodeURIComponent(filename).replace(/\.zip$/i, "");
  } catch {
    return filename.replace(/\.zip$/i, "");
  }
}

// ── Cover / file URLs ─────────────────────────────────────────────────────────

function coverUrl(filename: string): string {
  return `/api/koofr/cover?id=${encodeURIComponent(encId(filename))}`;
}

// ── Paging helper ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 24;

function buildList(files: KoofrFile[], page: number): MangaListResponse {
  const zips = files.filter(
    (f) => f.type === "file" && f.name.toLowerCase().endsWith(".zip")
  );
  const start = (page - 1) * PAGE_SIZE;
  const slice = zips.slice(start, start + PAGE_SIZE);
  const items: MangaSummary[] = slice.map((f) => ({
    id: encId(f.name),
    title: zipTitle(f.name),
    thumbnail: coverUrl(f.name),
    type: "Manga",
    isNsfw: false,
  }));
  return { items, page, hasNextPage: start + PAGE_SIZE < zips.length };
}

// ── Source implementation ─────────────────────────────────────────────────────

export const KoofrSource: MangaSource = {
  id: "local.koofr",
  name: "My Koofr Library",
  lang: "all",
  isNsfw: false,

  async popular(opts: ListOptions): Promise<MangaListResponse> {
    const files = await listFiles(MANGA_ROOT);
    return buildList(files, opts.page ?? 1);
  },

  async latest(opts: ListOptions): Promise<MangaListResponse> {
    const files = (await listFiles(MANGA_ROOT)).sort(
      (a, b) => (b.modified ?? 0) - (a.modified ?? 0)
    );
    return buildList(files, opts.page ?? 1);
  },

  async search(query: string, opts: ListOptions): Promise<MangaListResponse> {
    const q = query.toLowerCase();
    const files = (await listFiles(MANGA_ROOT)).filter((f) =>
      zipTitle(f.name).toLowerCase().includes(q)
    );
    return buildList(files, opts.page ?? 1);
  },

  async details(id: string, _opts: DetailOptions): Promise<MangaDetail> {
    const filename = decId(id);
    return {
      id,
      title: zipTitle(filename),
      author: "",
      artist: "",
      synopsis: "",
      altTitles: [],
      status: "Unknown",
      type: "Manga",
      isNsfw: false,
      rating: 0,
      thumbnail: coverUrl(filename),
      genres: [],
      score: "",
      scorePosition: "none",
    };
  },

  async chapters(
    mangaId: string,
    _dedupe: boolean
  ): Promise<ChapterListResponse> {
    const now = Math.floor(Date.now() / 1000);
    const items: ChapterSummary[] = [
      {
        id: mangaId, // same id — pages() decodes it back to filename
        number: 1,
        title: "Chapter 1",
        scanlator: "Koofr",
        date: now,
      },
    ];
    return { items };
  },

  async pages(chapterId: string): Promise<PageListResponse> {
    const filename = decId(chapterId);
    const key = cacheKey(filename);
    const koofrPath = `${MANGA_ROOT}/${filename}`;

    const imageFiles = await extractZip(koofrPath, key);

    const pages: PageInfo[] = imageFiles.map((name, i) => ({
      index: i,
      url: `/api/koofr/file?dir=${key}&file=${encodeURIComponent(name)}`,
    }));

    return { chapterId, pages };
  },
};

// ── Exported helpers used by app.ts routes ────────────────────────────────────

/**
 * Returns the absolute path to the cover (first image) for a manga ID.
 * Triggers zip download + extraction on first call; subsequent calls are instant.
 */
export async function getKoofrCover(encodedId: string): Promise<string | null> {
  const filename = decId(encodedId);
  const key = cacheKey(filename);
  const koofrPath = `${MANGA_ROOT}/${filename}`;
  const images = await extractZip(koofrPath, key);
  if (images.length === 0) return null;
  return nodePath.join(CACHE_ROOT, key, images[0]);
}
