// @ts-ignore — app.mjs is pre-built by esbuild (esbuild-plugin-pino handles workers)
import app from "../artifacts/api-server/dist/app.mjs";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dir, "../artifacts/comix-web/dist/public");

if (process.env.VERCEL) {
  // Serve static assets (immutable cache for hashed filenames).
  app.use(
    express.static(staticDir, {
      index: false,
      maxAge: "1y",
      immutable: true,
      fallthrough: true,
    }),
  );

  // SPA fallback: serve index.html for any path not handled above.
  app.use((_req: any, res: any) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
