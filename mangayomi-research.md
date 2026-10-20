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

## Offline/download implementation details

The checked MangaYomi code uses an Isar database for persistent download queue records. Each download tracks succeeded, failed, total, isDownload, isStartDownload, and links to the chapter. The download provider persists progress, enforces concurrency and optional Wi-Fi-only behavior, stores chapter metadata, and downloads either manga pages, anime video files/HLS streams, or novel HTML. It writes manga pages to stable per-title/per-chapter disk paths, detects image formats, caches page lists separately using a hash of manga ID plus chapter URL, and can export CBZ archives.

MangaYomi's reader checks local files first and supports a downloaded-only mode. Its chapter page-list cache is separate from downloaded page files, uses an LRU size limit, and preserves request headers with cached page entries. Anime downloads are treated differently from image chapters: episodes resolve video lists, download either a normal media file or an M3U8 stream, and store subtitles alongside the episode.

MangaYomi's extension runtime uses the same source detail/chapter model for anime, but anime chapters represent episodes and the extension additionally implements `getVideoList(url)`, returning one or more video tracks. The runtime supports Dart, JavaScript, Mihon, LNReader, and Aidoku source languages. The app's extension editor explicitly includes `getVideoList` for anime sources.

ComiHub already has an IndexedDB/Cache Storage download path and AnimeGG plus AllManga video-capable server sources. Its current offline queue state is memory-only, offline chapter metadata is persisted only after completion, and offline metadata currently stores only page URLs, not video tracks or per-page headers. The next implementation should persist the queue, store structured offline pages/video tracks, use deterministic page-list cache keys, and add an offline-only guard before attempting live requests.

Additional source files inspected:

- https://github.com/kodjodevf/mangayomi/blob/main/lib/models/download.dart
- https://github.com/kodjodevf/mangayomi/blob/main/lib/modules/manga/download/providers/download_provider.dart
- https://github.com/kodjodevf/mangayomi/blob/main/lib/repositories/download_repository.dart
- https://github.com/kodjodevf/mangayomi/blob/main/lib/services/chapter_cache.dart
- https://github.com/kodjodevf/mangayomi/blob/main/lib/utils/downloaded_page_file.dart
- https://github.com/kodjodevf/mangayomi/blob/main/lib/models/source.dart
- https://github.com/kodjodevf/mangayomi/blob/main/lib/eval/javascript/service.dart
- https://github.com/kodjodevf/mangayomi/blob/main/lib/eval/dart/service.dart
