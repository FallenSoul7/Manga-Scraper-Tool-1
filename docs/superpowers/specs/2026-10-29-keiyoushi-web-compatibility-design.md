# Keiyoushi Web Compatibility Design

**Status:** Implementation in progress.

## Goal

Make the Keiyoushi repository catalog useful in ComiXHub's web app by adding
web-native handlers for shared extension families and source-specific exceptions.
Keep every repository entry visible even when its scraper is not yet compatible.
Show the compatibility state and isolate failures to the affected source.

## Confirmed product decisions

- Keep the existing **Sources**, **Extensions**, and **Anime** tabs. Do not add a
  duplicate **Other** tab.
- Keep Keiyoushi entries in the existing Extensions catalog.
- Show a **Custom** badge for ComiXHub-owned source handlers. If a repo entry and
  a ComiXHub handler share an ID, keep one row and show the Custom badge.
- Leave repository-only entries untagged.
- Prefer a hybrid implementation: shared family adapters plus targeted
  source-specific handlers.
- Keep all repository entries visible and searchable. A source's failure must
  not break the catalog or another source.

## Current project facts

- The Keiyoushi repository feed at
  `https://github.com/keiyoushi/extensions/raw/repo/index.pb` is a binary
  catalog. It contains package/source metadata and asset/package URLs; it does
  not contain the scraper implementation.
- The source implementations are maintained separately in
  `https://github.com/keiyoushi/extensions-source`.
- The current ComiXHub catalog has 1,361 Keiyoushi records. The existing API
  source registry has a much smaller set of handlers; metadata presence alone
  does not mean a web handler exists.
- The current Extensions tab already lists repository metadata, but its Add
  action is disabled for entries without a registered handler.
- Catalog metadata labels 345 entries as Madara, 158 as MangaThemesia, and 531
  without a theme package. These labels are useful for initial grouping, but
  they are not a complete inventory of source-code inheritance or behavior.

## Architecture

### 1. Catalog ingestion

- Ingest the Keiyoushi repository index and preserve each source's exact
  package, source, and language identifiers.
- Treat icons, names, versions, APK/JAR URLs, and home URLs as catalog metadata,
  not as executable web behavior.
- Validate duplicate IDs and malformed records. A bad entry should be reported
  individually rather than causing the entire catalog refresh to fail.
- Keep the existing catalog response shape compatible while adding explicit
  origin and compatibility metadata.

### 2. Source-code inventory and family translation

- Read the corresponding source modules from `extensions-source`, matching
  source code to the package/source release represented by the catalog entry.
  Do not assume the repository's latest `main` branch matches every published
  package version.
- Inventory actual inheritance, shared libraries, and overridden methods.
  Theme-package labels are hints, not proof that two scrapers are equivalent.
- Implement web-native TypeScript adapters for common base families. Translate
  only known, bounded patterns and data-shaped source configuration into the
  existing `MangaSource` contract.
- Use a targeted TypeScript adapter when a source overrides behavior that the
  family adapter cannot represent.
- Do not execute downloaded APKs, JARs, Kotlin, or arbitrary extension code in
  the API process or browser.
- Preserve Apache-2.0 copyright and notices for any code that is directly
  adapted. Upstream site access rules remain independent of that license.

### 3. Runtime registry and compatibility state

- Keep the current `MangaSource` interface as the web runtime contract.
- Register generated family adapters and reviewed custom adapters by stable
  source ID. ComiXHub handlers take precedence for an ID collision and are
  identified as custom.
- Every catalog row gets one explicit compatibility state:
  - **Ready**: a web handler implements the required source flow.
  - **Experimental**: a handler exists but has known gaps or has not passed all
    verification checks.
  - **Needs adapter**: no compatible web handler is available yet.
- Preserve catalog visibility regardless of compatibility state. Do not mark
  an unhandled source Ready or return fabricated empty results.
- Return source-scoped, retryable errors for blocked pages, changed selectors,
  unsupported operations, malformed responses, timeouts, and rate limits.

### 4. Extensions page

- Keep the existing Extensions tab as the single repository catalog browser.
- Keep all repository records searchable and filterable by language and the
  existing adult-content policy.
- Show the Custom badge only for ComiXHub-owned handlers, including ID
  collisions. Repository-only entries receive no origin badge.
- Show compatibility state separately from the Custom badge. Keep entries
  visible when they need an adapter, and enable Add for every repository entry
  so users can try each one. Add registers source metadata locally; it does not
  download or execute the Android APK/JAR. Opening an entry without a web handler
  must show an explicit Needs adapter state rather than fake results or a generic
  failure.
- Do not change the existing Sources or Anime tab behavior as part of the
  initial compatibility work.

## Delivery sequence

1. **Inventory:** Decode the repository feed, reconcile package/source IDs with
   the source-code repository, and produce a family/override coverage report.
2. **Compiler and runtime boundary:** Add deterministic input validation,
   source-to-handler mapping, explicit compatibility states, and source-scoped
   errors. Keep source code out of runtime execution. Keep metadata Add available
   for every catalog entry, independently of scraper readiness.
3. **First family adapters:** Choose the largest genuinely shared families
   after inspecting their source modules. Verify representative sources with
   fixtures before enabling the family broadly.
4. **UI integration:** Add the Custom badge and compatibility states to the
   existing Extensions tab; retain current filters, ordering, and tab structure.
5. **Expand and repair:** Add more families and custom handlers based on
   observed gaps. Keep unmatched sources visible as Needs adapter.

## Verification

- Catalog tests cover parsing, source IDs, language metadata, icons, duplicate
  records, and an individual malformed entry without losing unrelated entries.
- Adapter fixtures cover listing, search, details, chapters, and pages for each
  supported family, including family-specific overrides.
- Failure fixtures cover unsafe destinations, redirects outside the declared
  host, blocked responses, malformed HTML/JSON, timeouts, and unsupported
  source operations.
- Registry tests verify stable IDs, custom-handler precedence, and explicit
  compatibility states.
- UI tests verify all catalog entries remain visible/searchable, Custom badges
  appear only for ComiXHub-owned handlers, Add is available for handled and
  unhandled entries, and one source failure does not replace the catalog with an
  error state.
- Live upstream checks are separate from deterministic CI tests.

## Limits and success criteria

The catalog can be fully visible before all scrapers are translated. The
compatibility layer should expand coverage by source family, but it must not
claim that every entry is working until that entry has a real web handler.
Success means repository entries remain discoverable, supported common
families work through ComiXHub's web API, custom sources are clearly marked,
and failures are explicit and isolated rather than hidden or fabricated.
