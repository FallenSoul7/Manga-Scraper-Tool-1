import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import http from "http";
import path from "path";  // 👈 add this

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url?.startsWith("/api/image") ?? false,
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👇 Add this block – serve static files from comix-web/public
// The path is relative to the compiled output (dist). Adjust if needed.
const publicPath = path.join(__dirname, "../../comix-web/public");
app.use("/public", express.static(publicPath));

app.use("/api", router);

// In development, proxy all non-API requests to the Vite dev server...
if (process.env.NODE_ENV === "development") {
  // ... rest unchanged
}

export default app;
