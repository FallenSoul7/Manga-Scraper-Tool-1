# Vercel to Render backend failover

Vercel API requests are handled by the catch-all function at `api/[...path].js` (or the equivalent function inside `artifacts/comix-web` when that directory is the Vercel project root).

## Current order

1. Primary: `https://manga-scraper-tool-2.onrender.com`
2. Fallback: `https://comihub-backend.onrender.com`

The proxy uses the primary first and retries the fallback when the primary cannot be reached or returns HTTP `502`, `503`, or `504`. Application-level `4xx` responses are returned without switching backends.

## Optional Vercel environment variables

The code has these defaults, but the URLs can be overridden in Vercel without another code change:

```text
COMIHUB_PRIMARY_BACKEND=https://manga-scraper-tool-2.onrender.com
COMIHUB_FALLBACK_BACKEND=https://comihub-backend.onrender.com
```

Set them for the **Production** environment and redeploy after changing them.

## Backend requirements

Both Render services should share the same `DATABASE_URL` and `SESSION_SECRET` when they serve the same users and database. `FRONTEND_URL` must allow the Vercel origin on both services. Verify both `/api/healthz` and `/api/sources/catalog` independently after deployment.
