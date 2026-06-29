import type { MangaSource } from "./types";
import { ComixSource } from "./comix";
import { MangaDexSource } from "./mangadex";
import { MangafreakSource } from "./mangafreak";
import { DanbooruSource } from "./danbooru";
import { createMadaraSource } from "./madara";
import { createMangaThemesiaSource } from "./mangathemesia";
import { HentaiFoxSource } from "./hentaifox";
import { NineHentaiSource } from "./ninehentai";
import { ComickFanSource } from "./comickfan";
import { AsuraScansSource } from "./asurascans";
import { OnlyTheBestHentaiSource } from "./onlythebesthentai";
import { WebtoonsSource } from "./webtoons";
import { XkcdSource } from "./xkcd";
import { HentaiYogaSource } from "./hentaiyoga";
import { PandaChaikaSource } from "./pandachaika";
import catalogJson from "./catalog.generated.json" with { type: "json" };

interface CatalogExtension {
  id: string;
  slug: string;
  name: string;
  lang: string;
  isNsfw: boolean;
  versionCode: number;
  extClass: string;
  themePkg: string | null;
  baseUrl: string | null;
  icon: string | null;
}
interface CatalogFile {
  generatedAt: number;
  count: number;
  extensions: CatalogExtension[];
}
const catalog = catalogJson as CatalogFile;

const SOURCES_BY_ID = new Map<string, MangaSource>();
function register(source: MangaSource) {
  SOURCES_BY_ID.set(source.id, source);
}
register(ComixSource);
register(MangaDexSource);
register(MangafreakSource);
register(DanbooruSource);
register(HentaiFoxSource);
register(NineHentaiSource);
register(ComickFanSource);
register(AsuraScansSource);
register(OnlyTheBestHentaiSource);
register(WebtoonsSource);
register(XkcdSource);
register(HentaiYogaSource);
register(PandaChaikaSource);

// Madara-themed sources
register(createMadaraSource({
  id: "en.resetscans",
  name: "Reset Scans",
  baseUrl: "https://reset-scans.org",
  lang: "en",
}));
register(createMadaraSource({
  id: "en.manhuaplus",
  name: "Manhua Plus",
  baseUrl: "https://manhuaplus.com",
  lang: "en",
}));
// Utoon (Cloudflare-protected; may rate-limit but registered for completeness)
register(createMadaraSource({
  id: "en.utoon",
  name: "Utoon",
  baseUrl: "https://utoon.net",
  lang: "en",
}));

// Mangathemesia-themed sources
register(createMangaThemesiaSource({
  id: "all.mihentai",
  name: "MiHentai",
  baseUrl: "https://mihentai.com",
  lang: "all",
  isNsfw: true,
}));
register(createMangaThemesiaSource({
  id: "en.elftoon",
  name: "Elf Toon",
  baseUrl: "https://elftoon.com",
  lang: "en",
}));
// Thunder Scans uses /comics (not /manga) and the MangaThemesiaAlt variant
register(createMangaThemesiaSource({
  id: "all.thunderscans",
  name: "Thunder Scans",
  baseUrl: "https://en-thunderscans.com",
  lang: "all",
  mangaUrlDirectory: "/comics",
}));

export function getSource(id: string | undefined | null): MangaSource {
  const key = id && id.trim() ? id : ComixSource.id;
  const src = SOURCES_BY_ID.get(key);
  if (!src) {
    throw new Error(
      `Source "${key}" is in the catalog but its handler hasn't been implemented in this web build yet. Try a supported source.`,
    );
  }
  return src;
}

export function getSourceOrNull(id: string): MangaSource | null {
  return SOURCES_BY_ID.get(id) ?? null;
}

export function isSupported(id: string): boolean {
  return SOURCES_BY_ID.has(id);
}

export function listSupportedIds(): string[] {
  return Array.from(SOURCES_BY_ID.keys());
}

export function getCatalog(): CatalogFile {
  return catalog;
}

export const DEFAULT_SOURCE_ID = ComixSource.id;
