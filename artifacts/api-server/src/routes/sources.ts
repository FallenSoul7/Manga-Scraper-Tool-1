import { Router } from "express";
import catalog from "../sources/catalog.generated.json" assert { type: "json" };

const router = Router();

router.get("/catalog", (_req, res) => {
  res.json(catalog);
});

export default router;
