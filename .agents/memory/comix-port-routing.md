---
name: Comix Lounge port routing
description: How ports are wired in the Comix Lounge monorepo dev environment and why.
---

## Rule
The `artifacts/api-server: API Server` workflow is artifact-managed (cannot be deleted) and binds port 8080, which Replit maps to external port 80 (the main preview URL). The `artifacts/comix-web: web` workflow runs the Vite dev server on port 19597 (external 3000).

In development, `artifacts/api-server/src/app.ts` uses `http-proxy-middleware` to forward all non-`/api` requests to `http://localhost:19597` so that port 8080 (external 80) serves the React SPA correctly.

**Why:** Port 8080→80 is Replit's primary preview port. If the API server doesn't proxy to Vite, the main URL returns "Cannot GET /".

**How to apply:** Any time the API server is modified, ensure the dev proxy catch-all (at the bottom of app.ts, guarded by `NODE_ENV === "development"`) remains in place and that the `http-proxy-middleware` package is installed in `@workspace/api-server`.
