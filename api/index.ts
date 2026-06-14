// @ts-ignore — app.mjs is pre-built by esbuild (esbuild-plugin-pino handles workers)
import app from "../artifacts/api-server/dist/app.mjs";
import { createReadStream, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dir, "../artifacts/comix-web/dist/public");

const MIME: Record<string, string> = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "application/javascript",
  ".mjs":   "application/javascript",
  ".css":   "text/css",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".webp":  "image/webp",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
  ".json":  "application/json",
};

if (process.env.VERCEL) {
  app.use((req: any, res: any, next: any) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api/")) return next();

    const filePath = path.join(staticDir, req.path);

    try {
      const stat = statSync(filePath);
      if (stat.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] ?? "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader(
          "Cache-Control",
          ext === ".html"
            ? "no-cache, no-store, must-revalidate"
            : "public, max-age=31536000, immutable",
        );
        if (req.method === "HEAD") {
          res.setHeader("Content-Length", stat.size);
          return res.end();
        }
        createReadStream(filePath).pipe(res);
        return;
      }
    } catch {
      // not found — fall through to SPA
    }

    // SPA fallback
    const indexPath = path.join(staticDir, "index.html");
    try {
      const stat = statSync(indexPath);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      if (req.method === "HEAD") {
        res.setHeader("Content-Length", stat.size);
        return res.end();
      }
      createReadStream(indexPath).pipe(res);
    } catch {
      next();
    }
  });
}

export default app;
