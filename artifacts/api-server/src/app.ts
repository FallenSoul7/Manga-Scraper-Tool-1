import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import http from "http";

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

app.use("/api", router);

// In development, proxy all non-API requests to the Vite dev server (port 19597)
// so that port 8080 (the external-facing port) serves the full React SPA.
// We use Node's built-in http module directly to avoid any URL-encoding issues
// that third-party middleware can introduce with Vite's ?v= cache-busting params.
if (process.env.NODE_ENV === "development") {
  const VITE_PORT = 19597;

  app.use("/", (req, res) => {
    const options: http.RequestOptions = {
      hostname: "localhost",
      port: VITE_PORT,
      path: req.url,           // preserves query string as-is (e.g. ?v=abc123)
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${VITE_PORT}`,
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: "Dev proxy error", detail: err.message });
      }
    });

    req.pipe(proxyReq, { end: true });
  });
}

export default app;
