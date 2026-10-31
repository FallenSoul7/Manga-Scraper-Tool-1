# ComiHub handoff for the next AI

**Updated:** 2026-10-31
**Purpose:** Resume the native/client-side migration without confusing the current staged implementation with the final goal.

## Product and constraints

ComiHub is a React/Vite web app, an Express API, and Android/iOS Capacitor shells. Preserve the reader, library, AI chat, settings, billing, authentication, and source-management features. The user prefers direct pushes to `main`, not feature branches. Scraper implementations live in the private `FallenSoul7/Frwilxe-Hub` repository consumed by the main monorepo; never ask end users to connect to or type that repository URL. The user-facing flow is **System → Extensions → Browse sources**.

The target is a native mobile app that gets approved, declarative source recipes from a lightweight registry, stores them on the device, and fetches/parses manga content locally. Do not promise zero Render scraping traffic until all supported sources have been migrated and verified.

## Current implementation after Phase 1

- **Native networking foundation:** Capacitor's bundled `CapacitorHttp` fetch/XHR bridge is enabled in `capacitor.config.ts`. The common `clientFetch()` uses omitted credentials, blocked redirects, and `no-referrer`; existing client source and Tier 1 requests use it. Android and iOS `cap sync` passed. Native app packages were not built, and no physical-device network test has been performed.
- **Device-first sources:** MangaDex, Webtoons, Asura Scans, and Thunder Scans now try their bundled client adapters first, including when Render is unavailable. If local fetching fails, the current server fallback remains enabled. The official registry labels these four `runtime: "device-first"`; other official sources are labeled `backend`. This label is not a promise of device-only execution.
- **Registry:** `GET /api/sources/registry` is the sole public source-index route. It returns validated metadata generated from supported private-package adapter IDs; `builtin.universal` is excluded. The index is cached locally and in IndexedDB. It does **not** yet carry selectors/URL rules for every source, and the app does not download the private TypeScript scrapers.
- **Tier 1:** A separate user-entered raw-GitHub JSON path is restricted to public raw JSON under `FallenSoul7`. Tier 1 manifests are validated declarative data, use `DOMParser`, and never execute JavaScript. Browser CORS still applies; native requests use `clientFetch()`.
- **Cloud sync:** `/api/library/sync` now uses bounded strict Zod schemas for text library, category, progress/history, and installed-source-ID data. Older full `installedSources` objects are validated and reduced to IDs before persistence; client restore never recreates source manifests from cloud IDs. Unknown fields and embedded `data:`/`blob:` media are rejected. No media bytes are sent in the library-sync payload.
- **Koofr/K-Cafe:** Its package adapter/exports, API routes and media proxies, frontend source/reader handling, assets, and ZIP-only dependencies were removed. Local/backup/cloud restore drops the old installation but preserves saved library metadata. The user confirmed they manually deleted `KOOFR_EMAIL` and `KOOFR_APP_PASSWORD` from Render; that dashboard change was not independently read back by the agent.
- **Endpoint cleanup:** The legacy `/api/sources/catalog` compatibility alias was removed. The service worker and AI source listing use `/api/sources/registry`.

## Important limitation — Render scraping is not retired

Most official sources still execute private backend adapters on Render. Their source listings, details, chapters, media proxy paths, and some AI source behavior may still use the backend. The four device-first adapters have a backend fallback; this intentionally remains until the local path is verified. The ordinary website remains subject to browser CORS. Native networking avoids browser CORS, but does not bypass authentication, bot challenges, rate limits, TLS, or site terms, and direct requests expose the user's IP address to source sites/CDNs.

Do not remove `/api/popular`, `/api/manga`, `/api/chapter`, other source-content routes, or remaining media proxies yet. Keep them only as migration fallbacks until local execution coverage is proven. Preserve unrelated AI/auth/billing/library functionality.

## Validation and deployment status

The current change set passed `pnpm run typecheck`, the API tests (including five strict library-sync schema cases and K-Cafe exclusion coverage), API and frontend production builds, service-worker syntax validation, and Capacitor sync for both Android and iOS. Vite still reports its existing large-chunk warning. These checks do not substitute for APK/IPA builds, end-to-end native-device testing, or a production deploy. The Render backend is configured for manual deploys in the existing runbook; production state must be checked after a deploy.

## Next work

1. Audit each supported source adapter independently: actual host/API, page shape, direct-request/CORS behavior, login/bot/anti-automation dependencies, image hosts, and feasibility for a strict declarative recipe versus reviewed bundled adapter.
2. Design and validate a versioned registry recipe schema for suitable sources. Expose only metadata/rules, never remote JavaScript. Save complete recipes to device IndexedDB.
3. Implement client-side search/list, details, chapters, images/video where appropriate, downloads, and AI source behavior for verified sources. Exercise representative Android/iOS flows and confirm `no-referrer`, response bounds, and offline/local persistence.
4. Measure and audit all requests. Only after every supported native path is verified, remove Render source-scraping/media-proxy routes and make web CORS limits explicit. Preserve auth, AI, billing, sync metadata, health, and the registry.
5. Recheck Supabase JSONB sync contents and production deployment. Do not claim the final architecture is complete before those checks.

For the detailed manifest/security contract and staged checklist, see [`docs/TIER1-EXTENSIONS.md`](TIER1-EXTENSIONS.md) and [`TODO.md`](../TODO.md).
