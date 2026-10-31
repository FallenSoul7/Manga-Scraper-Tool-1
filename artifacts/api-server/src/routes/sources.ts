import { Router } from "express";
import { getCatalog, getSourceManifests, isSupported } from "@fallensoul7/frwilxe-hub-sources";

const router = Router();
const manifests = getSourceManifests();
const catalogRaw = getCatalog();
type CompatibilityState = "ready" | "experimental" | "needs-adapter";

// Keep known incomplete/blocked handlers distinct from both fully usable
// sources and catalog entries that do not yet have a web implementation.
const EXPERIMENTAL_SOURCE_IDS = new Set([
  "en.comix",
  "en.comickfan",
  "en.utoon",
  "en.manhuaplus",
  "en.elftoon",
  "en.onlythebesthentai",
  "en.allmanga",
  "en.allanime",
  "en.royalroad",
]);

function compatibilityFor(id: string): CompatibilityState {
  if (!isSupported(id)) return "needs-adapter";
  return EXPERIMENTAL_SOURCE_IDS.has(id) ? "experimental" : "ready";
}

const enriched = {
  generatedAt: catalogRaw.generatedAt,
  count: catalogRaw.count,
  extensions: catalogRaw.extensions.map((ext) => ({
    id: ext.id,
    slug: ext.slug,
    name: ext.name,
    lang: ext.lang,
    isNsfw: ext.isNsfw,
    versionCode: ext.versionCode,
    iconUrl: ext.icon
      ? `/public/source-icons/${ext.icon as string}`
      : ext.id === "all.atsu" ? "https://atsu.moe/favicon.ico" : null,
    supported: isSupported(ext.id as string),
    origin: isSupported(ext.id as string) ? "custom" : "repository",
    compatibility: compatibilityFor(ext.id as string),
    manifest: manifests.find(manifest => manifest.id === ext.id || (ext.id === "en.allanime" && manifest.id === "en.allmanga")) ?? null,
  })),
};

router.get("/catalog", (_req, res) => {
  res.json(enriched);
});

router.get("/manifests", (_req, res) => {
  res.json({ manifests });
});

export default router;
