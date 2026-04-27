# Comix Reader

A web replica of Tachiyomi/Mihon's reading experience for comix.to. Browse, build a personal library, track progress, and read in the browser.

## Architecture

This is a pnpm monorepo with two main artifacts:

- **`artifacts/api-server`** — Express 5 (ESM) server on `/api`. Wraps the comix.to v2 JSON API, ports the original Kotlin `Hash.kt` (RC4 + 5 rounds of byte mutations) to TypeScript so chapter listings work, and proxies cover/page images.
  - Endpoints: `/api/healthz`, `/api/popular`, `/api/latest`, `/api/search`, `/api/manga/:id`, `/api/manga/:id/chapters`, `/api/chapter/:id/pages`, `/api/image?url=...`.
  - Hash signing: `src/lib/hash.ts` — round1..round5 each does `RC4(getKeyBytes(idx)) → XOR mutKey → switch(i%10) byte mutations`, with prefix-key bytes prepended for first N indices, then URL-safe base64 (no padding). Sent as `_=<hash>&time=1` on chapter requests.
  - Image proxy: allows any public http(s) URL but blocks loopback / private IPs (RFC1918, link-local, IPv6 ULA / link-local) to prevent SSRF. Necessary because comic page CDNs use rotating subdomains (e.g. `jdpw.wowpic5.store`).

- **`artifacts/comix-web`** — React + Vite app (`@workspace/comix-web`) at preview path `/`. Calm "reading lounge" theme (sand/terracotta, Plus Jakarta Sans + Playfair Display). Light + dark themes.
  - **Pages**: `/` (Browse: Popular + Latest), `/search`, `/library`, `/updates`, `/history`, `/manga/:id`, `/reader/:chapterId`, `/settings`, `/stats`, 404.
  - **Library** (`/library`): categories (custom, with default), search filter, sort (title / recently added / last read / unread), filters (unread / completed / ongoing / NSFW), grid + list views, multi-select edit mode for bulk move/remove/mark-read.
  - **Updates** (`/updates`): runs `useQueries` over the whole library to surface new chapters since the user last opened each manga; "Mark all seen" + per-manga refresh; header dot badge.
  - **History** (`/history`): grouped by day, chapter progress bar, remove single entry / clear all.
  - **Manga detail**: Add-to-library, category picker, "Continue reading", per-chapter read state pill, mark-all-read/unread, kebab menu per chapter.
  - **Reader**: 4 directions (Webtoon / Vertical / LTR / RTL), 3 fits (Width / Height / Original), 3 backgrounds (Paper / Black / Gray), page indicator (clickable jump), keyboard shortcuts, screen wake-lock, last-page restore + per-second debounced progress save, prev/next chapter nav.
  - **Settings**: appearance (theme), library (default category, edit categories), reader defaults, backup/restore JSON, reset, link to stats.
  - **Stats** (`/stats`): library size, chapters read, estimated reading time, top 5 read titles, reading streak, category counts.

- **`lib/api-spec`** — OpenAPI 3.1 source of truth at `lib/api-spec/openapi.yaml`. Orval generates:
  - `lib/api-client-react` — typed `useQuery` hooks consumed by the frontend.
  - `lib/api-zod` — runtime zod schemas; `src/index.ts` re-exports the conflicting `GetChaptersParams` / `GetMangaDetailsParams` from the types module under `*ParamsType` aliases to avoid clashing with the zod schemas of the same name.
  - Run `pnpm --filter @workspace/api-spec run codegen` after editing the spec.

## Frontend state

All user data lives in a single localStorage namespace `comix-lounge:v1`, validated with zod. The store (`artifacts/comix-web/src/lib/storage.ts`) exposes a Zustand-style `useStore(selector)` hook plus an actions object (`storeActions.addToLibrary`, `recordProgress`, `markChapterRead`, `setReader`, `setTheme`, `exportBackup`, `importBackup`, etc.). Cross-tab sync via the `storage` event.

The legacy `useSettings` hook remains for things that are *API* params (NSFW filter, poster quality, dedupe, alt names, score position) so they can be wired directly into the generated API hooks.

## Conventions

- Always send `Referer: https://comix.to/` on outbound requests to comix.to (API and image fetches).
- NSFW genre IDs (`87264, 8, 87265, 13, 87266, 87268`) are excluded as `genres[]=-{id}` query params when `nsfw=false`.
- Manga IDs are `hash_id` (the slug prefix on `/title/{id}-{slug}`), not numeric DB IDs.
- All comix.to + CDN images go through `/api/image?url=...` via the `proxyImage()` helper.
- When passing `query` options to a generated hook, you must include `queryKey: getXxxQueryKey(...)` — TanStack Query v5 requires it explicitly even when the hook would otherwise default it.
