# ComiHub handoff for the next AI

**Updated:** 2026-11-01
**Purpose:** Continue the user-directed native/client-side migration without repeating source audits or confusing the partial implementation with the final target.

## Product and constraints

ComiHub is a React/Vite web app, an Express API, and Android/iOS Capacitor shells. Preserve the reader, library, AI chat, settings, billing, authentication, and source-management features. The user prefers direct pushes to `main`. Scraper implementations live in the private `FallenSoul7/Frwilxe-Hub` repository; keep private repositories intact unless the user explicitly asks otherwise. Never ask end users to connect to or type the private repository URL. The user-facing source flow is **System → Extensions → Browse sources**.

The user and another AI have already completed the source feasibility audit. Do **not** repeat or launch full-source audits/reviews. Use their findings and the existing project adapters. Treat **Royal Road, Comix, Elf Toon, Manhua Plus, and Utoon as non-working** and leave them out of implementation unless the user changes that instruction.

## Current native-reader implementation

- `artifacts/comix-web/src/lib/client-fetch.ts` explicitly uses Capacitor 8's bundled `CapacitorHttp.request()` for native GET/HEAD source/manifest requests. It enforces HTTPS (except local development), removes `Referer`, maps the native response to `Response`, and respects abort signals. Ordinary web requests use `fetch()` and remain subject to browser CORS. No CORS setting was disabled.
- `artifacts/comix-web/capacitor.config.ts` enables the CapacitorHttp fetch/XHR bridge; Android and iOS Capacitor sync completed. CapacitorHttp is bundled with `@capacitor/core`; no separate HTTP package was added.
- The existing Tier 1 JSON manifest engine already validates selectors and URL rules as declarative data, stores the manifest locally/IndexedDB, fetches page HTML through `clientFetch()`, and parses it with `DOMParser`. Tier 1 adapters expose local list, detail, chapter-list, and image-page-list methods.
- Source browsing, manga details, chapter lists, page lists, and reader auto-appended chapters now prefer local adapters in Capacitor. Native source flows do not fall back to Render scraping. Server-backed list/detail/page routes remain as temporary **web-only** fallbacks.
- When an installed source has no device-side adapter (or lacks the required detail/chapter/page method), the native UI reports that limitation rather than silently using Render. The official `/api/sources/registry` currently returns source metadata, not selector recipes for every official source; therefore this is not yet 100% local for every listed source.

## Registry, sync, and removed integration

- `GET /api/sources/registry` is the sole public source-index endpoint. Official entries are metadata generated from the private adapter package; the app does not download private TypeScript scraper code.
- Tier 1 raw JSON manifests remain restricted to the approved public GitHub owner and never execute JavaScript.
- `/api/library/sync` uses strict bounded Zod validation for text library/progress/history/category metadata and installed source IDs. Unknown fields and embedded `data:`/`blob:` media are rejected; media bytes are not synced.
- Koofr/K-Cafe adapter/export, API routes/proxies, frontend behavior/assets, and ZIP-only dependencies were removed. Local/backup/cloud restore drops the old source installation without deleting saved library metadata. The user confirmed manually removing `KOOFR_EMAIL` and `KOOFR_APP_PASSWORD` from Render.

## Important limits and verification status

Render source-scraping and media-proxy endpoints remain deployed for ordinary-web fallback; they have not been retired. In native builds, sources without suitable local adapters are unavailable rather than server-scraped. Direct native requests bypass browser CORS but do not bypass authentication, bot challenges, rate limits, TLS, or site policies, and they expose the user's IP to source sites/CDNs. Images for currently supported native adapters and Tier 1 manifests load directly from the device with `no-referrer`; verify each supported media host on-device. Unsupported legacy integrations may still use their existing web proxy behavior.

The frontend TypeScript check/build and Android/iOS `cap sync` passed for the latest code. There has been **no APK/IPA build or on-device test**, so native network behavior is not yet verified on hardware. Keep the existing web fallback until device tests confirm local lists, details, chapters, image-page extraction, and media rendering. Do not claim 100% local execution yet.

## Next work

1. Implement local recipes/adapters for the already-audited working sources using the user's existing findings and adapter code; do not run another research audit. Preserve the five non-working exclusions above.
2. Build/install on Android and iOS and verify that source-page requests go directly through CapacitorHttp and do not hit Render (except for the source registry). Verify `no-referrer` and image rendering.
3. Only after native verification, remove Render source-scraping/media-proxy endpoints and make the browser CORS limitation explicit. Preserve AI, auth, billing, metadata sync, health checks, and `/api/sources/registry`.
4. Recheck Supabase JSONB sync contents and production deployment status before claiming the target architecture is complete.

For the manifest security contract and staged checklist, see [`docs/TIER1-EXTENSIONS.md`](TIER1-EXTENSIONS.md) and [`TODO.md`](../TODO.md).
