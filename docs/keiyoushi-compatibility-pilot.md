# Keiyoushi Extension Compatibility Pilot

## Goal

Gradually turn selected entries from ComiXHub's existing 1,361-entry
Keiyoushi catalog into working ComiXHub sources. Reimplement source behavior
behind ComiXHub-owned contracts; do not try to run Android extensions in the
web app.

This is a compatibility pilot, not a promise that every catalog entry can be
ported automatically.

## What exists today

- `catalog.generated.json` contains 1,361 extension records. Catalog presence
  is metadata, not proof that a source has a working handler.
- `registry.ts` manually registers working `MangaSource` handlers.
  `isSupported()` reports whether a handler is registered; unsupported catalog
  entries remain unavailable.
- `extensions/sdk.ts` defines a versioned manifest and `ExtensionAdapter`
  interface. Reviewed build-time adapters can now be validated and registered
  without replacing handwritten handlers, but no adapter module uses that
  bridge yet and there is no runtime installed-extension loader.
- `asMangaSource()` preserves compatibility with the current API, reader, and
  library while keeping declared capabilities and filters visible.
- Pawchive is already a separate registered source with dedicated creator and
  post pages. It is not part of the Keiyoushi manga-adapter pilot.
- The existing `extension-rewrite.md` already rules out executing downloaded
  source code with unrestricted server privileges. This plan makes that rule
  concrete.

### Supported-ID snapshot

The current registry exposes these supported IDs; catalog entries not listed
here remain metadata-only:

`all.atsu`, `all.danbooru`, `all.hentaifox`, `all.mangadex`,
`all.pandachaika`, `all.pawchive`, `all.thunderscans`, `all.webtoons`,
`builtin.universal`, `en.allanime`, `en.animegg`, `en.asurascans`,
`en.comickfan`, `en.comix`, `en.elftoon`, `en.mangafreak`, `en.manhuaplus`,
`en.ninehentai`, `en.novelfull`, `en.novelhall`, `en.onlythebesthentai`,
`en.ravenscans`, `en.resetscans`, `en.royalroad`, `en.rule34`, `en.utoon`,
`en.xkcd`, `local.koofr`.

Pilot status: `en.comicasura` is unsupported; `en.comickfan` is supported;
AllManga is listed as `en.allanime` and is supported, with `en.allmanga` kept
as the implementation ID.

## Findings from the three representative extensions

These examples cover different implementation families and should not be
treated as three instances of one parser:

1. **ComicAsura — shared HTML family with site-specific overrides**
   - Extends the Keiyoushi MangaThemesia base class.
   - Uses an advanced-search URL with sort, status, type, and genre filters.
   - Supplies custom selectors for list cards, details, chapters, and reader
     pages, plus a request rate limit.
   - Catalog ID: `en.comicasura`; the current ComiXHub registry does not
     register this ID. This is the best first new port because it tests whether
     the existing MangaThemesia family adapter can be safely configured or
     needs a small, explicit extension point.

2. **ComicKFan — custom HTML plus JSON chapters**
   - Implements its own list and detail parsing rather than extending
     MangaThemesia.
   - Uses the site's chapter-list JSON endpoint, then constructs chapter
     reading URLs and parses reader HTML.
   - ComiXHub already has a registered `ComickFanSource`; use it for parity and
     regression checks rather than creating a duplicate handler.

3. **AllManga — GraphQL, preferences, retries, and webview behavior**
   - Uses GraphQL POST requests for listings and metadata, custom filters,
     adult-content preferences, request throttling, retry/backoff behavior,
     and a webview-assisted chapter flow.
   - ComiXHub already registers `AllMangaSource` and preserves the legacy
     `en.allanime` ID as an alias.
   - Use it as a high-complexity boundary test. Its webview and preference
     behavior should remain an explicit source implementation, not be forced
     into a simple selector-based adapter.

The source repository declares Apache-2.0. Prefer independent TypeScript
implementations. If any source code is directly reused, preserve the required
copyright, license, and notice text. The upstream sites' access rules and
content rights remain separate from the source-code license.

## Recommended architecture

Keep the current `MangaSource` interface as the stable runtime contract for
the current manga reader. Connect the SDK to the registry through reviewed,
build-time adapters:

1. **Built-in TypeScript adapters** for complex behavior, such as GraphQL,
   custom authentication, webview-assisted reads, or unusual media flows.
2. **A restricted declarative adapter runner** for common, data-shaped
   operations: HTTPS requests to declared hosts, JSON-path or CSS-selector
   extraction, explicit pagination, and normalization into ComiXHub types.
3. **Family helpers** for genuinely shared site structures. A family adapter
   may expose narrow per-site configuration, but must not silently change
   existing sources when one site's selectors differ.

Do not execute APKs, Kotlin, downloaded JavaScript, arbitrary expressions, or
site-provided scripts in the API server. Do not add a crawler database,
scheduled crawling, Redis queue, or media-storage pipeline for this pilot;
requests remain on-demand through the existing source API.

### Request safety requirements

- HTTPS only; each adapter declares its allowed upstream hosts.
- Validate the initial URL and every redirect against the allowlist.
- Reject private, loopback, link-local, and non-HTTP destinations.
- Bound request time, response size, redirect count, concurrency, and
  per-source request rate.
- Support cancellation and explicit source errors; do not turn a blocked or
  malformed response into fake titles or blank pages.
- Keep adult classification explicit and source-specific.

### Capability requirements

The adapter manifest must describe only capabilities the handler actually
implements. A catalog item becomes “supported” only after it has a registered
handler and passes its required contract checks. Manga, anime/video, and novel
flows must remain distinct where the current `MangaSource` page contract
cannot represent the upstream behavior without loss.

## Delivery plan

### Phase 0 — Catalog and contract baseline

**Status:** The fixture-backed listing-to-page contract and manifest validation
are in place. The supported-ID inventory remains part of the pilot baseline.

- Keep the imported catalog as metadata; do not rebuild or recrawl it.
- Record the current supported IDs and the three pilot examples' current
  handler status.
- Add a source-contract test harness around the existing handler methods:
  listing, search, detail, chapters, pages, tags, and pagination.
- Add fixtures with synthetic or minimal redacted responses. Keep live upstream
  checks separate from deterministic tests.

### Phase 1 — SDK-to-registry bridge

**Status:** The validated build-time bridge is in place. Incomplete adapters
cannot be registered as supported sources; no new catalog source is registered
until its implementation and source-contract checks are complete.

- Make the existing `ExtensionAdapter` path usable by the registry without
  replacing existing handwritten handlers.
- Validate the manifest's adapter kind, media types, URL origin, capabilities,
  filters, and required method/capability consistency.
- Preserve catalog IDs and aliases exactly; do not rename IDs stored in user
  libraries.
- Keep unsupported sources visibly unsupported until a tested handler is
  registered.

### Phase 2 — First new port: ComicAsura

- Verify the current site URL, list/detail/chapter/reader responses, and its
  filtering and pagination behavior.
- Implement `en.comicasura` using the existing MangaThemesia helper only where
  its selectors and request behavior match the live site.
- Add narrowly scoped selector, date, filter, or request-policy configuration
  where needed; do not fork or alter defaults used by Elf Toon, Thunder Scans,
  or other registered sources.
- Register the handler only after list, search, details, chapters, pages, and
  tags have working fixtures and a successful live smoke check.

### Phase 3 — Existing-handler parity checks

- Run the same contract suite against ComicKFan and AllManga.
- For ComicKFan, verify the JSON chapter response and page extraction; an
  upstream client-side shell or blocked API must surface as an explicit error.
- For AllManga, verify GraphQL pagination, filters, IDs, retries, and the
  chapter/webview path. Keep behavior that needs custom code in its dedicated
  handler.
- Resolve any differences between the manifest and actual behavior before
  expanding the runner.

### Phase 4 — Expand by family, not by catalog count

- Group remaining catalog entries by proven implementation family and
  protocol, not by extension name alone.
- Select the next source only after confirming its live domain, source
  implementation, and terms/access constraints.
- Reuse a family adapter when endpoints, selectors, pagination, and media
  behavior truly match. Otherwise write a small source-specific adapter or
  leave the entry unsupported.
- Track supported, blocked, stale-domain, and untested states separately.

## Verification and acceptance

The pilot is complete when:

- ComicAsura is registered only if its live list, search/filter, detail,
  chapter, and page flows pass.
- Existing AllManga and ComicKFan handlers pass their regression checks without
  changing their IDs or breaking library/reader navigation.
- Empty, malformed, blocked, timed-out, and rate-limited responses produce
  visible, retryable errors instead of fabricated content.
- Request-safety tests reject unsafe URLs, redirect escapes, oversized
  responses, and unsupported schemes.
- Catalog support badges reflect registered and verified handlers, not catalog
  size.
- No downloaded APK/Kotlin/JavaScript is executed and no scraping job,
  database, or media-ingest pipeline is introduced.

## References

- [Keiyoushi distribution repository](https://github.com/keiyoushi/extensions)
- [Keiyoushi source repository](https://github.com/keiyoushi/extensions-source)
- [ComicAsura source](https://github.com/keiyoushi/extensions-source/tree/main/src/en/comicasura)
- [ComicKFan source](https://github.com/keiyoushi/extensions-source/tree/main/src/en/comickfan)
- [AllManga source](https://github.com/keiyoushi/extensions-source/tree/main/src/en/allanime)
- [ComiXHub extension rewrite notes](extension-rewrite.md)
