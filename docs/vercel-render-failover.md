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

Both Render services should share the same `DATABASE_URL` and `SESSION_SECRET` when they serve the same users and database. `FRONTEND_URL` must allow the Vercel origin on both services. Verify `/api/healthz` and the curated `/api/sources/registry` independently after deployment.

## Public content and session isolation

Health checks, the official source registry (`/api/sources/registry` and its `/api/sources/catalog` compatibility alias), extension list/search/tag/sort reads, manga details, chapter lists/pages, and source-media reads are public and do not require a user session. The API intentionally skips the Postgres-backed session lookup and Passport session deserialization for those read-only routes, so a slow session database cannot leave every extension page waiting. Keep this bypass limited to public `GET`/`HEAD` routes; authentication, library sync, and mutations still use the normal session middleware.

## Verified production status (2026-10-11)

- Primary `manga-scraper-tool-2.onrender.com` returns HTTP `503` because Render suspended it after the monthly quota was exceeded.
- Fallback `comihub-backend.onrender.com` returns HTTP `200` for `/api/healthz` and `/api/sources/catalog`; the Vercel production proxy also returns those successful fallback responses. Verify `/api/sources/registry` after deploying the registry change.
- The fallback's Render service is `ComiHub backend` (`srv-d8npuchkh4rs73ff8es0`), with manual deploys only. Deploy `c2e7ed4` (`dep-db5c39nlot8c73eeclo0`) is live.
- Through production Vercel, a validation-only empty-image request to `POST /api/ai/translate-page` returns HTTP `400` before provider invocation. A synthetic English speech-bubble test returned HTTP `200` from Gemini Flash-Lite with one Spanish translation region; the matching result was verified in the shared Supabase cache. No manga/source image was used.
- The primary remains suspended. The fallback is now live with the translation route; its auto-deploy setting is off, so trigger a manual deploy after future backend commits.
