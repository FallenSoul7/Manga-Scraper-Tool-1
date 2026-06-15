import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import sourcesRouter from "./sources";
import imageRouter from "./image";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/ai", aiRouter);
router.use("/sources", sourcesRouter);
router.use("/image", imageRouter);

export default router;
