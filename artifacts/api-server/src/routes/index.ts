import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import sourcesRouter from "./sources";
import imageRouter from "./image";
import mangaRouter from "./manga";
import authRouter from "./auth";
import libraryRouter from "./library";
import pandachaikaPageRouter from "./pandachaika-page";
import generationRouter from "./generation";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/ai", aiRouter);
router.use("/sources", sourcesRouter);
router.use("/image", imageRouter);
router.use("/auth", authRouter);
router.use("/library", libraryRouter);
router.use("/pandachaika-page", pandachaikaPageRouter);
router.use("/generation", generationRouter);
router.use(mangaRouter);

export default router;
