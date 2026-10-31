# ComiHub Native Client Migration

Keep existing Render source-scraper/proxy routes active as temporary web fallbacks until native fetching is tested on an actual Android/iOS device. Do not claim the full migration is complete or retire these endpoints before verification.

## Completed

- [x] **Native HTTP request path:** Android/iOS Capacitor config enables the bundled `CapacitorHttp` bridge. `clientFetch()` now calls `CapacitorHttp.request()` for native GET/HEAD source and manifest requests, strips `Referer`, applies HTTPS validation, and maps the native response back to `Response`. Ordinary web requests continue through `fetch()` and remain subject to browser CORS.
- [x] **Local reader path for installed recipes/adapters:** Tier 1 manifests are validated declarative JSON, stored locally, and parsed with `DOMParser`. Source browsing, manga details, chapter lists, image-page lists, and reader auto-append use local adapters in Capacitor; native paths do not fall back to Render. Existing Render endpoints remain available for the web fallback.
- [x] **No silent server scraping on unsupported native sources:** When a source has no local adapter (or lacks local detail/chapter/page support), the native app does not issue a source-scraping request to Render and displays an availability message. The ordinary web experience can still use the server fallback.
- [x] **Source feasibility review:** The user reports this was already completed with another AI. Do not repeat or launch full-source audits. Treat Royal Road, Comix, Elf Toon, Manhua Plus, and Utoon as non-working and leave them out of implementation work unless the user revises that instruction.
- [x] **Registry:** `GET /api/sources/registry` remains the only public source-index route. Its current official entries contain metadata, not declarative selectors for every source.
- [x] **Supabase sync guardrails:** `/api/library/sync` uses strict bounded Zod schemas for text library/progress/history/category metadata and installed source IDs. Unknown fields and embedded `data:`/`blob:` media are rejected; media bytes are not synced.
- [x] **Koofr/K-Cafe removal:** Its source adapter, API routes/proxies, frontend source/reader behavior, assets, and ZIP-only dependencies were removed. Local/backup/cloud restore drops only the old installation and preserves library metadata. The user confirmed the two Render credential variables were removed manually.
- [x] **Platform sync:** Frontend typecheck/build and Capacitor sync for Android and iOS passed. No APK/IPA build or physical-device test has been done.

## Remaining

- [ ] **Extend client support using existing findings:** Implement declarative selector manifests or reviewed client adapters for the already-audited working sources that lack local methods. Use the existing project adapter code and the user's prior audit; do not repeat source discovery.
- [ ] **Verify native fetching on device:** Build/install Android and iOS packages and test source list, details, chapters, image-page extraction, image rendering, and `no-referrer` behavior. Confirm native source paths do not contact Render except for the registry.
- [ ] **Retire server source routes only after verification:** Once all supported native source flows work on-device, remove source scraping/media proxies from Render and make browser CORS limits explicit. Until then, keep the existing endpoints only as web fallbacks. Preserve AI, authentication, billing, metadata sync, health checks, and `/api/sources/registry`.
- [ ] **Final cloud/privacy verification:** Confirm Supabase persists only approved text metadata and source IDs in the library-sync JSONB payload; no source image/video files, binary data URLs, or blobs are uploaded or proxied for migrated sources.
