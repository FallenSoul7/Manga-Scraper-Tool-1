import type { MangaSource } from "./types";
import { ComixSource } from "./comix";
import { MangaDexSource } from "./mangadex";
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
