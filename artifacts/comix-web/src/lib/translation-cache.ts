export interface TranslationRegion {
  id: string;
  sourceText: string;
  translatedText: string;
  /** Coordinates are normalized to the 0..1000 image space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TranslationCacheIdentity {
  imageSha256: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationCacheKey extends TranslationCacheIdentity {
  cacheKey: string;
  translationRevision: string;
}

export interface OfflineTranslationRecord extends TranslationCacheKey {
  sourceId: string;
  chapterId: string;
  pageIndex: number;
  regions: TranslationRegion[];
  provider: string;
  cachedAt: number;
  expiresAt: number;
}

const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
export const TRANSLATION_REVISION = "page-overlay-v1";

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(digest);
}

export async function getTranslationCacheKey(identity: TranslationCacheIdentity): Promise<TranslationCacheKey | null> {
  const imageSha256 = identity.imageSha256.trim().toLowerCase();
  const sourceLanguage = identity.sourceLanguage.trim().toLowerCase() || "auto";
  const targetLanguage = identity.targetLanguage.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(imageSha256) || !targetLanguage) return null;
  const translationRevision = TRANSLATION_REVISION;
  const material = [translationRevision, imageSha256, sourceLanguage, targetLanguage].join("\n");
  const cacheKey = await sha256(material);
  return cacheKey ? { cacheKey, imageSha256, sourceLanguage, targetLanguage, translationRevision } : null;
}

function validateRegions(value: unknown): TranslationRegion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const region = raw as Record<string, unknown>;
    const sourceText = typeof region.sourceText === "string" ? region.sourceText.slice(0, 1200) : "";
    const translatedText = typeof region.translatedText === "string" ? region.translatedText.slice(0, 1800) : "";
    const coords = [region.x, region.y, region.width, region.height].map(Number);
    if (!sourceText || !translatedText || coords.some(value => !Number.isFinite(value))) return [];
    const [x, y, width, height] = coords.map(value => Math.max(0, Math.min(1000, Math.round(value))));
    if (width < 4 || height < 4 || x >= 1000 || y >= 1000) return [];
    return [{
      id: typeof region.id === "string" ? region.id.slice(0, 80) : `region-${index + 1}`,
      sourceText,
      translatedText,
      x,
      y,
      width: Math.min(width, 1000 - x),
      height: Math.min(height, 1000 - y),
    }];
  });
}

/** Read one shared hit through a narrowly scoped Postgres RPC; browser access never exposes table or service-role credentials. */
export async function getSharedTranslation(cacheKey: string): Promise<{ regions: TranslationRegion[]; provider: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !/^[a-f0-9]{64}$/i.test(cacheKey)) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_chapter_translation_cache`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_cache_key: cacheKey }),
    });
    if (!response.ok) return null;
    const result = await response.json() as unknown;
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row !== "object") return null;
    const record = row as Record<string, unknown>;
    const regions = validateRegions(record.regions);
    const provider = typeof record.provider === "string" ? record.provider.slice(0, 100) : "Shared translation cache";
    return regions.length ? { regions, provider } : null;
  } catch {
    return null;
  }
}
