import { Router, type IRouter } from "express";
import path from "node:path";
import express from "express";
import { getCatalog, listSupportedIds } from "../sources/registry";

const router: IRouter = Router();

router.get("/sources/catalog", (_req, res) => {
  const cat = getCatalog();
  const supported = new Set(listSupportedIds());
  res.json({
    generatedAt: cat.generatedAt,
    count: cat.count,
    supportedIds: Array.from(supported),
    extensions: cat.extensions.map((e) => ({
      ...e,
      supported: supported.has(e.id),
      iconUrl: e.icon ? `/api/sources/icon/${e.icon}` : null,
    })),
  });
});

router.use(
  "/sources/icon",
  express.static(path.resolve(process.cwd(), "public/source-icons"), {
    maxAge: "30d",
    fallthrough: false,
  }),
);

export default router;
