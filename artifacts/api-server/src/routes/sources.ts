import { Router, type IRouter } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { getCatalog, listSupportedIds, getSourceOrNull } from "../sources/registry";

// Anchor icon path to the bundle's own directory so it is deterministic
// regardless of CWD. The bundle lives at dist/index.mjs; icons are at
// the sibling public/source-icons/ directory.
const __bundleDir = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.resolve(__bundleDir, "../public/source-icons");

const router: IRouter = Router();

router.get("/sources/catalog", (_req, res) => {
  const cat = getCatalog();
  const supported = new Set(listSupportedIds());
  res.json({
    generatedAt: cat.generatedAt,
    count: cat.count,
    supportedIds: Array.from(supported),
    extensions: cat.extensions.map((e) => {
      const src = getSourceOrNull(e.id);
      return {
        ...e,
        supported: supported.has(e.id),
        iconUrl: e.icon ? `/api/sources/icon/${e.icon}` : null,
        popularSorts: src?.popularSorts ?? [],
      };
    }),
  });
});

router.use(
  "/sources/icon",
  express.static(ICONS_DIR, {
    maxAge: "30d",
    fallthrough: false,
  }),
);

export default router;
