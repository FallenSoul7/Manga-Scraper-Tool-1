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
const CLIENT_FIRST_SOURCE_IDS = new Set([
  "all.atsu",
  "all.danbooru",
  "all.mangadex",
  "all.pawchive",
  "all.webtoons",
  "en.asurascans",
  "all.thunderscans",
  "en.comickfan",
  "en.allmanga",
  "en.rule34",
  "en.xkcd",
  "en.royalroad",
  "all.hentaifox",
  "en.onlythebesthentai",
  "en.mangafreak",
  "en.novelfull",
  "en.novelhall",
  "en.ninehentai",
  "en.resetscans",
  "all.pandachaika",
  "en.pandachaika",
  "en.animegg",
  "all.mihentai",
  "en.ravenscans",
  "en.allanime",
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
      runtime: CLIENT_FIRST_SOURCE_IDS.has(extension.id as string) ? "device-first" as const : "backend" as const,
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
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=86400");
  res.json(officialRegistry);
}

router.get("/registry", sendOfficialRegistry);

export default router;
