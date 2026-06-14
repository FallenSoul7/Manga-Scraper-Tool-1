import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mangaRouter from "./manga";
import sourcesRouter from "./sources";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mangaRouter);
router.use(sourcesRouter);
router.use(aiRouter);

export default router;
