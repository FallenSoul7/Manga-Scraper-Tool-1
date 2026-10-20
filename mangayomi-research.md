# MangaYomi research

Checked 2026-10-20.

## Findings

MangaYomi is an Apache-2.0 Flutter application for Android, iOS, macOS, Linux, and Windows. Its official README lists manga, webtoon, comic, novel, anime, movie, local/offline reading, configurable readers, tracker integrations (MyAnimeList, AniList, SIMKL, Trakt, Kitsu), categories, themes, and local/cloud backups.

The companion extension repository contains a live manga index with 363 entries across many languages and a novel index with 5 entries. The repository metadata says it is archived, and the anime index URL referenced by the README currently returns 404, so anime extensions should not be assumed to be maintained through that repository.

The extension model is useful for ComiHub: normalized methods for popular, latest, search, filters, details, chapter/page lists, and video lists; source metadata includes language, URL, version, icon, adult flag, and minimum app version. Extensions may be written in Dart or JavaScript, with reusable multisource adapters such as Madara. The JavaScript guidance also supports custom headers, HTML/DOM parsing, JSON APIs, pagination, dates, and video URLs.

A comparison of names found 129 overlaps between MangaYomi's manga index and the current ComiHub catalog. Relevant alternatives include MangaDex, Asura Scans, MangaFreak.online, Raven Scans, and Thunder Scans, although domain and implementation differences mean the code cannot be assumed to work unchanged.

## Recommended reuse

Adapt the ideas rather than porting the Flutter app wholesale: extension manifest/repository ingestion, normalized source contracts, source capability flags, filter definitions, custom request headers, pagination metadata, retries/timeouts, offline catalog snapshots, and later tracker integrations. Port only high-value source adapters after testing their current domains.

The app and extension repository both declare Apache-2.0. Any direct code reuse should preserve copyright/license notices and attribution. Source-site terms and availability still need to be checked independently.

## Sources

- https://github.com/kodjodevf/mangayomi
- https://github.com/kodjodevf/mangayomi/blob/main/README.md
- https://github.com/kodjodevf/mangayomi-extensions
- https://github.com/kodjodevf/mangayomi-extensions/blob/main/README.md
- https://kodjodevf.github.io/mangayomi-extensions/index.json
- https://kodjodevf.github.io/mangayomi-extensions/novel_index.json
- https://github.com/kodjodevf/mangayomi-extensions/blob/main/CONTRIBUTING-JS.md
- https://github.com/kodjodevf/mangayomi-extensions/blob/main/CONTRIBUTING-DART.md
- https://github.com/kodjodevf/mangayomi/releases
