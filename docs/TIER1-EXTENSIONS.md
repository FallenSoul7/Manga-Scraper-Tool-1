# Tier 1 browser-side source manifests

Tier 1 is for simple manga sites whose public HTML can be read with CSS selectors. A manifest is configuration data only: the app validates it with Zod, fetches pages through `clientFetch()`, parses HTML with `DOMParser`, and extracts text and URL attributes. The app never evaluates, imports, or executes code from a manifest.

## Official source list

End users do not need to know or enter a repository URL. In **System → Extensions**, they choose **Browse sources**. The app reads the first-party `GET /api/sources/registry` index, validates its schema, and caches source metadata on the current device. The endpoint is generated from the private `Frwilxe-Hub` package and lists only source IDs implemented by that package; `builtin.universal` is excluded. The browser receives source metadata, not scraper code or private repository files.

The registry is the sole public source-index endpoint. Its entries include `kind: "server"` for the maintained backend adapter and a `runtime` field that describes current app dispatch:

- `device-first`: the app tries a bundled client adapter first; Render remains a temporary fallback.
- `backend`: source requests still use the backend adapter.

An older cached version-1 index may omit `runtime`; the client treats that as `backend`. The index is versioned and strict, and currently provides metadata only—not declarative selectors for every official source.

```json
{
  "schemaVersion": 1,
  "repository": {
    "id": "frwilxe-hub",
    "name": "Frwilxe Hub",
    "url": "https://github.com/FallenSoul7/Frwilxe-Hub"
  },
  "generatedAt": "2026-10-31T00:00:00.000Z",
  "extensions": [
    {
      "id": "all.mangadex",
      "name": "MangaDex",
      "lang": "all",
      "isNsfw": false,
      "versionCode": 1,
      "iconUrl": null,
      "compatibility": "ready",
      "kind": "server",
      "runtime": "device-first"
    }
  ]
}
```

The index currently marks MangaDex, Webtoons, Asura Scans, and Thunder Scans as `device-first`. Their client requests use the Capacitor native HTTP bridge in Android/iOS builds. Local requests are attempted even when Render is unavailable. If a local request fails, the existing backend fallback remains enabled during migration. Ordinary web browsers still enforce CORS and may need that fallback. This is a staged migration, not yet a 100% device-side scraper architecture.

## Tier 1 manifest import

The separate Tier 1 importer under **System → Extensions** accepts only HTTPS raw GitHub JSON URLs under the approved account:

```text
https://raw.githubusercontent.com/FallenSoul7/<public-repository>/<branch>/<path>.json
```

The URL must point to a public file. The importer sends a read-only GET with credentials omitted, blocks redirects, applies `no-referrer`, and limits the manifest response to 256 KiB. It rejects arbitrary websites, GitHub HTML pages, gists, and links owned by other accounts. The manifest and hostnames are shown for confirmation before installation.

The scraper package repository `FallenSoul7/Frwilxe-Hub` is private. A browser cannot read its raw files without a user credential, and the app does not request or store such credentials. Keep the private scraper repository private; publish Tier 1 JSON manifests in a separate public repository owned by `FallenSoul7`.

## Manifest schema (version 1)

```json
{
  "schemaVersion": 1,
  "sourceId": "sample-site",
  "sourceName": "Sample Manga",
  "baseUrl": "https://manga.example.com",
  "lang": "en",
  "isNsfw": false,
  "description": "Optional short description",
  "assetHosts": ["images.example-cdn.com"],
  "routes": {
    "popular": "/popular?page={page}",
    "latest": "/latest?page={page}",
    "search": "/search?q={query}&page={page}"
  },
  "selectors": {
    "mangaItems": ".manga-card",
    "mangaTitle": ".title",
    "mangaLink": "a",
    "mangaImage": "img",
    "detailImage": ".manga-cover img",
    "nextPage": "a.next",
    "detailTitle": "h1.entry-title",
    "detailAuthor": ".author",
    "detailArtist": ".artist",
    "detailSynopsis": ".summary",
    "detailStatus": ".status",
    "detailGenres": ".genres a",
    "chapterList": ".chapter-list a",
    "chapterLink": "a",
    "chapterTitle": ".chapter-name",
    "chapterNumber": ".chapter-number",
    "chapterDate": "time",
    "chapterImages": ".chapter-content img"
  }
}
```

`schemaVersion`, `sourceId`, `sourceName`, `baseUrl`, `routes`, and required selectors are mandatory. `sourceId` must be a short slug; unknown fields are rejected. The installed source ID is namespaced from the GitHub repository and manifest ID so it cannot impersonate a built-in source.

All three route templates must stay on the `baseUrl` HTTPS origin. `popular` and `latest` require `{page}`; `search` requires `{query}` and `{page}`. The query value is URL-encoded by the app. The list selectors (`mangaTitle`, `mangaLink`, `mangaImage`) are evaluated inside each `mangaItems` card. `nextPage` is evaluated on the result page and may be omitted for a one-page source.

On a manga detail document, `detailTitle`, `detailImage`, author/artist/synopsis/status/genres are optional selectors. `chapterList` selects chapter rows or anchors. `chapterLink` defaults to `a`; the selected node may itself be the link. `chapterTitle`, `chapterNumber`, and `chapterDate` are optional. `chapterImages` selects image elements; the app reads only image URL attributes such as `data-src`, `data-original`, `data-lazy-src`, `srcset`, and `src`.

`assetHosts` is an optional list of exact HTTPS hostnames for external CDN images. Without an entry, images and icons must use the `baseUrl` hostname. Wildcard hosts are not supported.

## Security and data handling

- The validated Tier 1 JSON and official source metadata are cached on the device (local storage plus the IndexedDB manifest cache). The full Tier 1 manifest is not sent to the ComiHub API or Supabase.
- Supabase sync stores only bounded, whitelisted text metadata for library entries, reading progress/history, categories, and installed source IDs. Legacy full source objects from older clients are validated and reduced to IDs before persistence.
- Unknown fields, executable code, HTML, and embedded `data:` or `blob:` media payloads are rejected. Media bytes are never uploaded or stored by cloud sync; URLs remain text metadata.
- Source requests use HTTPS, `clientFetch()`, omitted ambient credentials, blocked redirects, bounded responses/timeouts, and `referrerPolicy: "no-referrer"`. Native Capacitor builds use the device HTTP stack; the ordinary web app remains subject to browser CORS.
- The app extracts strings and URLs from parsed DOM. It does not render remote HTML, inject scripts, load JavaScript extensions, or call `eval()`.
- Media URLs must use HTTPS and the base host or an explicitly listed asset host. Reader image requests also use `no-referrer`.

## Limitations

Browser CORS still applies to direct web requests. A source that requires user login/cookies, bot-challenge solving, JavaScript rendering, or a private API will not work as a Tier 1 manifest; it needs a reviewed adapter or a different integration. Native HTTP bypasses browser CORS, but does not bypass site login requirements, bot protections, rate limits, TLS, or terms. Direct source requests expose the user's IP address to the source site and any listed image CDN. Tier 1 is for ordinary image-based manga pages, not arbitrary executable or video extensions.
