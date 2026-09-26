import { Router } from "express";
import { isSupported } from "../sources/registry";
import catalogRaw from "../sources/catalog.generated.json" assert { type: "json" };

const router = Router();

const universal = {
  id: "builtin.universal",
  slug: "builtin-universal",
  name: "Universal",
  lang: "all",
  isNsfw: false,
  versionCode: 1,
  // Universal contains anime sources as well as manga sources. Use the
  // existing AnimeGG mark instead of leaving the virtual source header blank.
  iconUrl: "/public/source-icons/en.animegg.svg",
  supported: true,
};

const enriched = {
  generatedAt: catalogRaw.generatedAt,
  count: catalogRaw.count + 1,
  extensions: [universal, ...(catalogRaw.extensions as Array<Record<string, unknown>>).map((ext) => ({
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
  }))],
};

router.get("/catalog", (_req, res) => {
  res.json(enriched);
});

export default router;
