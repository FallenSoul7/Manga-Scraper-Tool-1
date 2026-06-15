import { Router, type IRouter, type Request, type Response } from "express"; // Import Request/Response
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Add types to the callback parameters
router.get("/healthz", (_req: Request, res: Response) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
