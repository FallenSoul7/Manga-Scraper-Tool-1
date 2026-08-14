# AllManga Dual-Media Extension Design

**Date:** 2026-08-14  
**Status:** Approved for implementation

## Goal

Make the existing `en.allanime` / AllManga extension a reliable dual-media source:

- Show manga and anime together in one browse/search experience.
- Let users filter the same source to Manga only or Anime only.
- Open manga chapters in the existing comic reader.
- Open anime episodes through the existing in-app `VideoPlayer`, using the same media flow already used by Koofr-style video sources.
- Repair AllManga manga page loading so valid chapters do not end in an empty reader.

## Scope and non-goals

This change is limited to the AllManga source, its source-browse controls, and the shared source/detail plumbing needed to identify media safely. It does not create a second anime player, migrate unrelated sources, or redesign the library globally.

The existing source ID remains `en.allanime`. Existing unprefixed AllManga IDs remain valid and continue to resolve as manga.

## Architecture

### Media-aware source contract

Add optional media metadata to the source-facing summary/detail models:

- `mediaType: "manga" | "anime"` on list results and details.
- Existing consumers that do not use the field continue to behave as before.

The API list routes accept an optional source-specific media filter. For AllManga:

- omitted / `all`: fetch both manga and anime and merge them for one combined page;
- `manga`: fetch only `mangas`;
- `anime`: fetch only `shows`.

The source itself owns the GraphQL queries and response normalization. Other sources retain their current behavior.

### Media-safe identifiers

AllManga IDs are encoded at the source boundary:

- manga records use `manga:<allanime-id>`;
- anime records use `anime:<allanime-id>`;
- legacy IDs without a prefix are interpreted as manga.

Chapter IDs include the media type and parent ID so a manga chapter cannot be sent to the anime resolver and vice versa. The parser must tolerate URL encoding because IDs are passed through route parameters.

The browse UI uses the encoded ID in links. Existing saved manga entries and old reader URLs continue to work through the legacy fallback.

## Backend data flow

### Manga

1. List/search/popular requests query AllAnime `mangas`.
2. Results normalize title, thumbnail, and `mediaType: "manga"`.
3. Details query `manga`.
4. Chapters use the manga's available chapter metadata.
5. Pages query `chapterPages`.
6. Page normalization accepts:
   - absolute image URLs;
   - host-plus-path values;
   - relative paths;
   - string and object entries in `pictureUrls`.
7. Empty or missing page edges produce a source error with the API condition rather than an unexplained blank reader.

### Anime

1. List/search/popular requests query AllAnime `shows`.
2. Results normalize title, thumbnail, and `mediaType: "anime"`.
3. Details query `show`.
4. Episodes query AllAnime `episodes` / episode metadata and map each episode to a chapter-like item.
5. The page resolver reads the episode's available `sourceUrls`, selecting a playable URL using the source's existing preference order.
6. The resolver returns one video page. The existing reader detects an all-video page list and renders `VideoPlayer`.

If an episode has no playable URL, the API returns a descriptive unavailable-episode error. It must not return a successful empty page list for a known episode.

### Combined pagination

For `all`, the source requests the current page from both media collections, normalizes both result sets, merges them deterministically, and reports another page while either collection has more results. The UI therefore receives one normal list and does not need separate API clients.

## Frontend behavior

### Source browse

AllManga gets a compact media filter near the existing source controls:

- **All** — default; manga and anime appear together.
- **Manga** — only comic titles.
- **Anime** — only video titles.

The filter is source-specific and is preserved in the browse URL/session state so reload and back-navigation retain the selected view. Cards keep the existing grid and link route. Anime cards show an unobtrusive video/media indicator and retain the existing NSFW badge rules.

The Anime tab keeps listing AllManga as an available anime source. Opening it navigates to AllManga with `media=anime`. The normal Sources tab still lists the same installed source, and opening it defaults to `media=all`.

### Details and reader

The existing manga detail page remains the shared detail surface:

- manga details retain chapter wording and reader controls;
- anime details use episode wording and a clear “Play”/video affordance;
- anime chapter selection navigates through the same `/reader/:chapterId` route;
- the reader's existing all-video detection displays `VideoPlayer`.

The reader must include the source ID when navigating from an AllManga item, ensuring the API resolves the media-specific chapter correctly.

## Error handling

- GraphQL HTTP errors and GraphQL `errors` remain surfaced as source errors.
- Missing media records, invalid media IDs, missing chapter/episode identifiers, and empty page/video resolutions return specific errors.
- The source browse page keeps its existing loading, retry, and empty states.
- A manga page response with no image edges is shown as “chapter unavailable” with the actual source error available to the user, rather than looking like an indefinite load.
- Anime episodes with multiple source URLs use the first playable source in the defined order; a failed URL should allow the existing video player error state to be shown.

## Verification plan

### API

- Build the API server.
- Exercise AllManga list endpoints for `all`, `manga`, and `anime`.
- Search for a known manga and a known anime.
- Resolve one manga detail, chapter list, and page list; assert non-empty image URLs.
- Resolve one anime detail, episode list, and page list; assert a video URL.
- Verify legacy unprefixed manga IDs.
- Verify invalid and unavailable IDs produce descriptive errors.

### Frontend

- Build the React/Vite web artifact.
- Open AllManga from Sources and verify the combined list.
- Switch Manga and Anime filters and verify the result sets.
- Open AllManga from the Anime tab and verify the Anime filter is selected.
- Open a manga chapter and confirm images render.
- Open an anime episode and confirm the existing video player renders.
- Check loading, empty, error, and back-navigation behavior.

## Self-review

- **Placeholders:** none.
- **Consistency:** combined browsing, separate filtering, media-safe IDs, and shared reader/video behavior use the same source and route model.
- **Scope:** changes are limited to AllManga and the shared fields/routes required for media identity.
- **Ambiguity resolved:** “show both and separate” means All is the default combined view, with explicit Manga and Anime filters and an Anime-tab entry point to the Anime filter.