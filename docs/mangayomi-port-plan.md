# ComiHub cross-platform and extension migration plan

## Goal

Expand ComiHub from an installable web PWA into a shared React application that can run in the browser, as a desktop application on Windows/macOS/Linux, and as a sideloadable mobile build where platform signing permits.

The MangaYomi application and extension repositories are Apache-2.0. Any directly reused code must retain its copyright and license notices. Source-site availability, terms, and content rights remain independent of the application license.

## Delivery stages

### Stage 1: Web/PWA foundation

- Keep the current Vite/React web build as the canonical UI.
- Keep the service worker and device-side catalog caching.
- Fix standalone safe-area behavior so the reader toolbar does not reserve a duplicate top gap.
- Make offline state, source errors, and cached catalogs explicit instead of leaving indefinite loading states.

### Stage 2: Native shells

- Add a Tauri 2 desktop shell around the same production frontend.
- Produce Windows installers, macOS app/DMG builds, and Linux AppImage/deb/rpm builds in CI.
- Add an Android wrapper/build path after the shared native bridge is stable.
- Treat iOS IPA distribution as a signed build: AltStore/SideStore or TestFlight requires the appropriate Apple signing credentials.
- Keep API requests remote by default, with an optional local backend mode for desktop power users.

### Stage 3: Extension runtime

- Define a versioned ComiHub extension manifest containing id, name, language, base URL, icon, version, adult flag, capabilities, and runtime type.
- Normalize source methods around popular, latest, search, filters, details, chapters, pages, and video tracks.
- Add reusable adapters for common site families such as Madara and MangaThemesia.
- Support custom headers, referers, pagination, date parsing, language variants, and source-specific filters.
- Add extension health checks, error states, retries, and safe timeouts.
- Port high-value working MangaYomi sources in tested batches rather than importing the archived catalog blindly.

### Stage 4: Reader/library parity

- Offline chapter downloads and resumable storage.
- Backup/restore for library, categories, history, progress, and installed extensions.
- Reader modes, RTL/LTR direction, webtoon paging, zoom, double-tap, and gesture controls.
- Tracker integrations after the core sync model is stable.
- Anime playback and episode sources as a separate media capability, not as a manga-source assumption.

## Acceptance criteria

- Browser/PWA behavior remains unchanged except for the standalone toolbar correction.
- Every packaged target uses the same source metadata and API contracts.
- Unsupported source capabilities are hidden or clearly labeled.
- A failed source returns a retryable error rather than an endless spinner.
- Directly reused Apache-2.0 code keeps attribution and license notices.
- Source health and adult-content metadata are explicit and cannot silently classify general sources as 18+.
