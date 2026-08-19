import { Router } from "express";
import { isSupported } from "../sources/registry";
import catalogRaw from "../sources/catalog.generated.json" assert { type: "json" };

const router = Router();

const enriched = {
  generatedAt: catalogRaw.generatedAt,
  count: catalogRaw.count,
  extensions: (catalogRaw.extensions as Array<Record<string, unknown>>).map((ext) => ({
    id: ext.id,
    slug: ext.slug,
    name: ext.name,
    lang: ext.lang,
    isNsfw: ext.isNsfw,
    versionCode: ext.versionCode,
    iconUrl: ext.icon ? `/public/source-icons/${ext.icon as string}` : null,
    supported: isSupported(ext.id as string),
  })),
};

router.get("/catalog", (_req, res) => {
  res.json(enriched);
});

export default router;
