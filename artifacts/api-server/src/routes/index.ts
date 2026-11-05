import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import sourcesRouter from "./sources";
import mangaRouter from "./manga";
import authRouter from "./auth";
import lockRouter from "./lock";
import libraryRouter from "./library";
import pandachaikaPageRouter from "./pandachaika-page";
import paypalRouter from "./paypal";
import paddleRouter from "./paddle";
import readerCommentsRouter from "./reader-comments";
import rustScraperRouter from "./rust-scraper";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/ai", aiRouter);
router.use("/sources", sourcesRouter);
router.use("/auth", authRouter);
router.use("/auth", lockRouter);
router.use("/library", libraryRouter);
router.use("/pandachaika-page", pandachaikaPageRouter);
router.use("/paddle", paddleRouter);
router.use("/paypal", paypalRouter);
router.use("/reader-comments", readerCommentsRouter);
router.use(rustScraperRouter);
router.use(mangaRouter);

export default router;
