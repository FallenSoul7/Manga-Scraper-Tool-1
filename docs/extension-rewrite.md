# ComiHub extension rewrite

ComiHub will not copy MangaYomi's Flutter evaluator or import its remote extension source files wholesale. MangaYomi is Apache-2.0, but source websites, domains, and extension behavior still need independent verification. We are adapting the useful ideas into a native TypeScript runtime with ComiHub-owned contracts.

## New boundary

`artifacts/api-server/src/extensions/sdk.ts` defines the ComiHub extension API v1. An extension declares a validated manifest and implements a normalized adapter for:

- popular, latest, and search listings;
- pagination metadata;
- details and language metadata;
- chapter lists;
- image, novel, or video page contracts;
- source tags and custom filters;
- request headers, referers, and range-aware media policies.

The adapter is converted to the existing `MangaSource` interface through `asMangaSource`, so the current API routes, Universal source, library, reader, and offline downloader remain compatible.

## Porting rules

1. Port metadata and behavior, not opaque source bundles.
2. Keep one adapter per upstream family when the sites genuinely share a protocol.
3. Validate every manifest before installation.
4. Never execute remote extension JavaScript with unrestricted server privileges.
5. Keep adult classification explicit and source-specific.
6. Preserve source attribution and Apache-2.0 notices if any direct code is ever reused.
7. Test domains, request headers, pagination, language variants, and chapter/page responses independently before adding an extension to the catalog.

## Stages

### Stage 1 — completed in this batch

- Define the independent SDK and manifest validator.
- Normalize request policy, pagination, and media contracts.
- Bridge SDK adapters into the current server source registry.

### Stage 2 — next

- Add a local extension repository index with signed or pinned metadata.
- Add install/update/remove flows for manifest-only extensions.
- Add a safe declarative HTTP/HTML/JSON adapter runner with allowlisted hosts and bounded timeouts.

### Stage 3 — source ports

Port high-value sources one at a time, beginning with sources that have stable public APIs. Each port needs fixture tests for listing, detail, chapters, language variants, pages, and protected media headers. Failed or stale domains remain disabled rather than blocking Universal.

### Stage 4 — anime and advanced media

Add a video-list contract for episode sources, subtitle/audio tracks, HLS metadata, and range requests. Reuse the existing ComiHub video player and offline video records instead of introducing a second player model.
