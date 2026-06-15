import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import sourcesRouter from "./sources";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/ai", aiRouter);
router.use("/sources", sourcesRouter);

export default router;
