import express, { type Express } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,
  process.env.FRONTEND_URL,
]
  .filter(Boolean)
  .map((u) => u!.replace(/\/+$/, "")) as string[]; // strip trailing slashes

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const localhostRe = /^https?:\/\/localhost(:\d+)?$/;
    const replitRe = /\.replit\.dev$/;
    const vercelRe = /\.vercel\.app$/;
    if (
      localhostRe.test(origin) ||
      replitRe.test(origin) ||
      vercelRe.test(origin) ||
      allowedOrigins.includes(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Source"],
  exposedHeaders: ["Content-Disposition"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: { id: unknown; method: string; url?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: { statusCode: number }) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.options(/\/.*/, cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === "production") {
  const __dir = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.resolve(__dir, "../../comix-web/dist/public");
  app.use(express.static(staticDir));
}

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const __dir = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.resolve(__dir, "../../comix-web/dist/public");
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
