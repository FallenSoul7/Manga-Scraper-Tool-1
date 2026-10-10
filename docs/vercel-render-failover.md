# Vercel to Render backend failover

Vercel API requests are handled by the catch-all function at `api/[...path].js` (or the equivalent function inside `artifacts/comix-web` when that directory is the Vercel project root).

## Current order

1. Primary: `https://manga-scraper-tool-2.onrender.com`
2. Fallback: `https://comihub-backend.onrender.com`

The proxy uses the primary first and retries the fallback on connection failures. It also retries HTTP `502`, `503`, or `504` for any method. For safe `GET`, `HEAD`, and `OPTIONS` requests, it additionally retries `408` and any other `5xx` response. Other `4xx` responses—including `429` rate limits, authentication failures, and validation errors—are returned without switching backends. This avoids turning a normal client error into a second request while extending failover for safe reads.

## Optional Vercel environment variables

The code has these defaults, but the URLs can be overridden in Vercel without another code change:

```text
COMIHUB_PRIMARY_BACKEND=https://manga-scraper-tool-2.onrender.com
COMIHUB_FALLBACK_BACKEND=https://comihub-backend.onrender.com
```

Set them for the **Production** environment and redeploy after changing them.

## Backend requirements

Both Render services should share the same `DATABASE_URL` and `SESSION_SECRET` when they serve the same users and database. `FRONTEND_URL` must allow the Vercel origin on both services. Verify both `/api/healthz` and `/api/sources/catalog` independently after deployment.

## Verified production status (2026-10-11)

- Primary `manga-scraper-tool-2.onrender.com` returns HTTP `503` because Render suspended it after the monthly quota was exceeded.
- Fallback `comihub-backend.onrender.com` returns HTTP `200` for `/api/healthz` and `/api/sources/catalog`; the Vercel production proxy also returns those successful fallback responses.
- The fallback currently returns HTTP `404` for `POST /api/ai/translate-page`, so it is healthy but does not yet run the translation-route commit. The reader UI is deployed, but end-to-end page translation remains unavailable until the current backend code is deployed to that service.
- The connected Render workspace currently exposes only the primary service; do not claim the fallback's deployment was updated until its Render service is accessible and its route is verified.
