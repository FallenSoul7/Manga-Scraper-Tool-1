/**
 * AllAnime API Crypto Token System
 * =================================
 *
 * Since mid-2026 the AllAnime API (now at api.mkissa.net) requires an
 * AES-256-GCM encrypted "aaReq" token for persisted GraphQL queries.
 * Without it, chapter page queries return AA_CRYPTO_MISSING and the
 * response contains broken/placeholder data (the "symbol images" bug).
 *
 * The token is built from rotating key material published in a
 * keygen.json file on GitHub. The key contains:
 *   - AES-256 key (per content lane: k7=episode, k9=chapter pages)
 *   - epoch (rotates server-side)
 *   - build_id
 *   - persisted query hashes
 *
 * Token construction (matching the site's implementation):
 *   1. Floor current timestamp to 5-minute bucket
 *   2. Build JSON payload: {v, ts, epoch, buildId, qh, k}
 *   3. Derive IV = SHA-256("epoch:buildId:queryHash:ts:lane") first 12 bytes
 *   4. AES-256-GCM encrypt the payload
 *   5. Token = base64(0x01 + IV + ciphertext + GCM tag)
 *
 * Responses may also be encrypted as "tobeparsed" — a base64 AES-GCM
 * payload using the same key. We decrypt it with the lane key, falling
 * back to a static key derived from "Xot36i3lK3:v1".
 */

import { createHash, createCipheriv } from "node:crypto";

const KEYGEN_URL =
  "https://raw.githubusercontent.com/jfang324/manga-archiver-keygen/main/keygen.json";

const STATIC_KEY_SEED = "Xot36i3lK3:v1";
const TS_BUCKET_MS = 300_000; // 5 minutes
const CACHE_TTL_MS = 240_000; // 4 minutes (refresh before server rotation)

interface KeygenData {
  build_id: string;
  epoch: number;
  lanes: Record<string, string>; // lane name -> 32-byte hex key
  query_hashes: Record<string, string>; // query name -> 64-char hash
}

// Hardcoded fallback values (from the keygen repo as of Aug 2026).
// Used when the live fetch fails so the source degrades gracefully.
const FALLBACK_KEYGEN: KeygenData = {
  build_id: "130",
  epoch: 2955,
  lanes: {
    k7: "deeb2732190ceee0d84c7668d79b64ddcd5f27b9f858f2327fe29a7841b7b5da",
    k9: "5f42da00ea39c82b4cb4527d0595b324ad9cc69a468a49522ca2255e3ac1786e",
    k2: "b0e925ef5a0acdf7cce5e2dcedee0f9ccf919cdedead7202850f107d9fa2d76b",
  },
  query_hashes: {
    search: "6aa0ec525141123d2a64012a5ace12ba1cdef2f47d12abfec62158f3a7c73f5f",
    manga: "97db525f763de75fd165a3dfd4bf6570adaa914a327ebd3cda0bd703e92de758",
    chapter: "9c06f42995949a3b6e15e843d7832668f4460416ba94881a2cdb9a906266ad40",
  },
};

let cachedKeygen: KeygenData | null = null;
let cachedAt = 0;

async function fetchKeygen(): Promise<KeygenData> {
  if (cachedKeygen && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedKeygen;
  }
  try {
    const res = await fetch(KEYGEN_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`keygen HTTP ${res.status}`);
    const data = (await res.json()) as KeygenData;
    if (data && data.build_id && data.epoch && data.lanes && data.query_hashes) {
      cachedKeygen = data;
      cachedAt = Date.now();
      return data;
    }
    throw new Error("keygen response missing required fields");
  } catch {
    if (cachedKeygen) return cachedKeygen;
    return FALLBACK_KEYGEN;
  }
}

/**
 * Build the aaReq token for a persisted GraphQL query.
 *
 * @param queryHash - The persisted query sha256 hash
 * @param lane - Content lane: "k7" for episodes, "k9" for chapter pages
 * @returns { token, buildId } - The base64 token and matching build_id header
 */
export async function buildAaReq(
  queryHash: string,
  lane: string,
): Promise<{ token: string; buildId: string }> {
  const keygen = await fetchKeygen();
  const keyHex = keygen.lanes[lane];
  if (!keyHex) throw new Error(`No key for lane ${lane}`);
  const key = Buffer.from(keyHex, "hex");

  const ts = Math.floor(Date.now() / TS_BUCKET_MS) * TS_BUCKET_MS;
  const payload = JSON.stringify({
    v: 1,
    ts,
    epoch: keygen.epoch,
    buildId: keygen.build_id,
    qh: queryHash,
    k: lane,
  });

  const ivStr = `${keygen.epoch}:${keygen.build_id}:${queryHash}:${ts}:${lane}`;
  const iv = createHash("sha256").update(ivStr).digest().subarray(0, 12);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const token = Buffer.concat([Buffer.from([0x01]), iv, ciphertext, tag]).toString("base64");
  return { token, buildId: keygen.build_id };
}

/**
 * Get the persisted query hash for a query type, using the live keygen
 * values with fallback to hardcoded constants.
 */
export async function getQueryHash(query: "search" | "manga" | "chapter"): Promise<string> {
  const keygen = await fetchKeygen();
  return keygen.query_hashes[query] ?? FALLBACK_KEYGEN.query_hashes[query];
}

/**
 * Decrypt a "tobeparsed" response payload.
 *
 * The API may return `{ data: { tobeparsed: "base64..." } }` instead of
 * plaintext data. This decrypts it using the lane key (GCM mode) or the
 * static fallback key.
 *
 * @param encoded - Base64 encoded payload from data.tobeparsed
 * @param lane - Content lane (e.g. "k9" for chapter pages)
 * @returns Parsed JSON object, or null if decryption fails
 */
export async function decodeTobeparsed(
  encoded: string,
  lane: string,
): Promise<Record<string, unknown> | null> {
  const keygen = await fetchKeygen();
  let raw: Buffer;
  try {
    raw = Buffer.from(encoded, "base64");
  } catch {
    return null;
  }

  if (raw.length < 29) return null; // 1 header + 12 IV + 16 tag minimum

  const iv = raw.subarray(1, 13);
  const ciphertext = raw.subarray(13, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);

  // Try keys in order: lane key, then static key
  const staticKey = createHash("sha256").update(STATIC_KEY_SEED).digest();
  const keys: Buffer[] = [];
  const laneHex = keygen.lanes[lane];
  if (laneHex) {
    try { keys.push(Buffer.from(laneHex, "hex")); } catch { /* skip */ }
  }
  keys.push(staticKey);

  for (const key of keys) {
    try {
      const { createDecipheriv } = await import("node:crypto");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const result = JSON.parse(plaintext.toString("utf-8"));
      if (result && typeof result === "object") return result;
    } catch {
      // Try next key
    }
  }

  // Fallback: try CTR mode (the API has flip-flopped between GCM and CTR)
  for (const key of keys) {
    try {
      const { createDecipheriv } = await import("node:crypto");
      const ctrIv = Buffer.concat([iv, Buffer.from([0x00, 0x00, 0x00, 0x02])]);
      const decipher = createDecipheriv("aes-256-ctr", key, ctrIv);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const result = JSON.parse(plaintext.toString("utf-8"));
      if (result && typeof result === "object") return result;
    } catch {
      // Try next key/mode
    }
  }

  return null;
}

/** Reset the keygen cache (e.g. after a stale crypto error). */
export function resetKeygenCache(): void {
  cachedKeygen = null;
  cachedAt = 0;
}
