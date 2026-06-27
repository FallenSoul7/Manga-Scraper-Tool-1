import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import passport from "passport";
import router from "./routes";
import { buildSessionMiddleware } from "./routes/auth";
import { logger } from "./lib/logger";
import http from "http";
import path from "path";  
import axios from "axios"; // 🚀 Added Axios for processing proxy data chunks

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
  ...(process.env["FRONTEND_URL"]
    ? [process.env["FRONTEND_URL"].replace(/\/+$/, "")]
    : []),
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin.endsWith(".vercel.app")) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply session + passport globally so ALL routes (including /api/library) can use req.isAuthenticated()
app.use(buildSessionMiddleware());
app.use(passport.initialize());
app.use(passport.session());

const iconPath = path.join(__dirname, "../../comix-web/public/public/source-icons");
app.use("/public/source-icons", express.static(iconPath));

const publicPath = path.join(__dirname, "../../comix-web/public");
app.use("/public", express.static(publicPath));

// 🚀 ADDED: Direct proxy interceptor to beat hotlink protections
app.get("/api/image-proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  const refererUrl = (req.query.referer as string) || "https://comickfan.com/";

  if (!targetUrl) {
    return res.status(400).send("Missing target image url parameter.");
  }

  try {
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer", 
      headers: {
        "Referer": refererUrl, 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      timeout: 15000,
    });

    res.set("Content-Type", response.headers["content-type"] || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400"); 
    
    return res.send(Buffer.from(response.data));
  } catch (error: any) {
    logger.error({ err: error.message, url: targetUrl }, "Image proxy routing failure");
    return res.status(500).send("Failed to retrieve proxy asset data.");
  }
});

app.use("/api", router);

if (process.env.NODE_ENV === "development") {
  // Development mode conditions remain here
}

export default app;
