import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mangaRouter from "./manga";
import sourcesRouter from "./sources";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mangaRouter);
router.use(sourcesRouter);

export default router;
