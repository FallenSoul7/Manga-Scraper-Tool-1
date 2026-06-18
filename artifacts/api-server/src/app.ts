import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import http from "http";
import path from "path";  

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
const allowedOrigins = [
  "http://localhost:19597",
  "http://localhost:8080",
  ...(process.env["FRONTEND_URL"] ? [process.env["FRONTEND_URL"]] : []),
];

app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin (no origin header) + server-to-server calls
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👇 THE FIX: Direct route to the double-nested folder
const iconPath = path.join(__dirname, "../../comix-web/public/public/source-icons");
app.use("/public/source-icons", express.static(iconPath));

// Fallback for any other standard public files
const publicPath = path.join(__dirname, "../../comix-web/public");
app.use("/public", express.static(publicPath));

app.use("/api", router);

// In development, proxy all non-API requests to the Vite dev server...
if (process.env.NODE_ENV === "development") {
  // ... rest unchanged
}

export default app;
