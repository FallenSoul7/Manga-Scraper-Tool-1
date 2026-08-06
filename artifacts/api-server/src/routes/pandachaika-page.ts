/**
 * GET /api/pandachaika-page?archive=63874&index=0
 *
 * Serves a single page image from a PandaChaika archive ZIP using
 * HTTP byte-range requests — no full download needed.
 */
import { Router } from "express";
import axios from "axios";
import { inflateRawSync } from "zlib";

const router = Router();

const BASE_URL   = "https://panda.chaika.moe";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── In-memory ZIP directory cache (per archive ID) ────────────────────────────
interface ZipEntry {
  name:              string;
  method:            number; // 0 = stored, 8 = deflate
  compressedSize:    number;
  uncompressedSize:  number;
  localHeaderOffset: number;
}

interface CacheEntry {
  entries:  ZipEntry[];
  fetchedAt: number;
  fileSize:  number;
  downloadUrl: string;
}

const cache = new Map<number, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function rangeBuffer(url: string, start: number, end: number): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    headers: {
      "User-Agent":  USER_AGENT,
      "Accept":      "*/*",
      "Referer":     BASE_URL + "/",
      "Range":       `bytes=${start}-${end}`,
    },
    timeout: 30000,
    maxRedirects: 5,
  });
  return Buffer.from(res.data);
}

async function getZipDirectory(archiveId: number): Promise<CacheEntry> {
  const now = Date.now();
  const cached = cache.get(archiveId);
  if (cached && now - cached.fetchedAt < CACHE_TTL) return cached;

  const downloadUrl = `${BASE_URL}/archive/${archiveId}/download/`;

  // 1. HEAD → file size
  const head = await axios.head(downloadUrl, {
    headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/", "Accept": "*/*" },
    timeout: 15000,
    maxRedirects: 5,
  });
  const fileSize = parseInt(String(head.headers["content-length"] ?? "0"), 10);
  if (!fileSize) throw new Error(`Could not get file size for archive ${archiveId}`);

  // 2. Read last 65 KB to locate EOCD (End of Central Directory)
  const tailSize = Math.min(65558, fileSize);
  const tail = await rangeBuffer(downloadUrl, fileSize - tailSize, fileSize - 1);

  // Find EOCD signature 0x06054b50 (little-endian) scanning right-to-left
  let eocdPos = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error("EOCD not found in archive");

  const cdSize   = tail.readUInt32LE(eocdPos + 12);
  const cdOffset = tail.readUInt32LE(eocdPos + 16);

  // 3. Range-request the Central Directory
  const cd = await rangeBuffer(downloadUrl, cdOffset, cdOffset + cdSize - 1);

  // 4. Parse CD entries
  const entries: ZipEntry[] = [];
  let pos = 0;
  while (pos < cd.length - 4) {
    if (cd.readUInt32LE(pos) !== 0x02014b50) break; // Central Directory signature
    const method            = cd.readUInt16LE(pos + 10);
    const compressedSize    = cd.readUInt32LE(pos + 20);
    const uncompressedSize  = cd.readUInt32LE(pos + 24);
    const nameLen           = cd.readUInt16LE(pos + 28);
    const extraLen          = cd.readUInt16LE(pos + 30);
    const commentLen        = cd.readUInt16LE(pos + 32);
    const localHeaderOffset = cd.readUInt32LE(pos + 42);
    const name              = cd.slice(pos + 46, pos + 46 + nameLen).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  // Sort by filename (case-insensitive, same as the Tachiyomi extension)
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const entry: CacheEntry = { entries, fetchedAt: now, fileSize, downloadUrl };
  cache.set(archiveId, entry);
  return entry;
}

async function getPageBuffer(archiveId: number, pageIndex: number): Promise<{ data: Buffer; mime: string }> {
  const { entries, downloadUrl } = await getZipDirectory(archiveId);

  if (pageIndex < 0 || pageIndex >= entries.length) {
    throw new Error(`Page index ${pageIndex} out of range (${entries.length} pages)`);
  }
  const entry = entries[pageIndex];

  // Read local file header (fixed 30 bytes) to get actual name/extra lengths
  const localHead = await rangeBuffer(downloadUrl, entry.localHeaderOffset, entry.localHeaderOffset + 29);
  if (localHead.readUInt32LE(0) !== 0x04034b50) throw new Error("Bad local file header signature");
  const localNameLen  = localHead.readUInt16LE(26);
  const localExtraLen = localHead.readUInt16LE(28);
  const dataStart     = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;

  // Range-request the compressed data
  const compressed = await rangeBuffer(downloadUrl, dataStart, dataStart + entry.compressedSize - 1);

  // Decompress if DEFLATE (method 8), else STORED (method 0)
  const data = entry.method === 8 ? inflateRawSync(compressed) : compressed;

  // Detect MIME from file extension
  const ext  = entry.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : "image/jpeg";

  return { data, mime };
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const archiveId = parseInt(String(req.query["archive"] ?? ""), 10);
  const pageIndex = parseInt(String(req.query["index"]   ?? ""), 10);

  if (isNaN(archiveId) || isNaN(pageIndex)) {
    res.status(400).json({ error: "Missing archive or index query param" });
    return;
  }

  try {
    const { data, mime } = await getPageBuffer(archiveId, pageIndex);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Length", data.length);
    res.end(data);
  } catch (err) {
    const msg = (err as Error).message;
    res.status(502).json({ error: msg });
  }
});

export default router;
