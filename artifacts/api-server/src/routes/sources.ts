import { Router } from "express";
import { getCatalog, isSupported } from "@fallensoul7/frwilxe-hub-sources";

const router = Router();
const catalogRaw = getCatalog();
const EXPERIMENTAL_SOURCE_IDS = new Set([
  "en.comix",
  "en.comickfan",
  "en.utoon",
  "en.manhuaplus",
  "en.elftoon",
  "en.onlythebesthentai",
  "en.allmanga",
  "en.allanime",
  "en.animegg",
  "en.royalroad",
]);

const registryExtensions = Array.from(new Map(
  catalogRaw.extensions
    .filter((extension) => isSupported(extension.id as string) && extension.id !== "builtin.universal")
    .map((extension) => [extension.id, {
      id: extension.id,
      name: extension.name,
      lang: extension.lang,
      isNsfw: extension.isNsfw,
      versionCode: extension.versionCode,
      iconUrl: extension.icon
        ? `/public/source-icons/${extension.icon as string}`
        : extension.id === "all.atsu" ? "https://atsu.moe/favicon.ico" : null,
      compatibility: EXPERIMENTAL_SOURCE_IDS.has(extension.id as string) ? "experimental" as const : "ready" as const,
      kind: "server" as const,
    }]),
).values()).sort((a, b) => a.name.localeCompare(b.name) || a.lang.localeCompare(b.lang));

const officialRegistry = {
  schemaVersion: 1 as const,
  repository: {
    id: "frwilxe-hub",
    name: "Frwilxe Hub",
    url: "https://github.com/FallenSoul7/Frwilxe-Hub",
  },
  generatedAt: new Date().toISOString(),
  extensions: registryExtensions,
};

function sendOfficialRegistry(_req: unknown, res: import("express").Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(officialRegistry);
}

router.get("/registry", sendOfficialRegistry);
// Keep the old URL stable for clients that still request it, but never expose
// the legacy 1,362-entry server catalog from this route again.
router.get("/catalog", sendOfficialRegistry);

export default router;
