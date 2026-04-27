# Comix Reader

A web replica of Tachiyomi's Comix extension that scrapes comix.to and serves a clean reading experience in the browser.

## Architecture

This is a pnpm monorepo with two main artifacts:

- **`artifacts/api-server`** — Express 5 (ESM) server on `/api`. Wraps the comix.to v2 JSON API, ports the original Kotlin `Hash.kt` (RC4 + 5 rounds of byte mutations) to TypeScript so chapter listings work, and proxies cover/page images so the browser isn't blocked by hotlinking.
  - Endpoints: `/api/healthz`, `/api/popular`, `/api/latest`, `/api/search`, `/api/manga/:id`, `/api/manga/:id/chapters`, `/api/chapter/:id/pages`, `/api/image?url=...`
  - Hash signing: `src/lib/hash.ts` — round1..round5 each does `RC4(getKeyBytes(idx)) → XOR mutKey → switch(i%10) byte mutations`, with prefix-key bytes prepended for first N indices, then URL-safe base64 (no padding). Sent as `_=<hash>&time=1` on chapter requests.
  - Comix client: `src/lib/comix.ts` — list/detail/chapter/page calls plus chapter dedupe (prefers official → scanlator 10702 → higher votes → newer updatedAt).

- **`artifacts/comix-web`** — React + Vite app (`@workspace/comix-web`) at preview path `/`. Calm "reading lounge" theme (Plus Jakarta Sans + Playfair Display, sand/terracotta palette).
  - Pages: `/` (Popular + Latest tabs), `/search`, `/manga/:id`, `/reader/:chapterId` (vertical-scroll webtoon reader), `/settings`.
  - Settings (NSFW toggle, poster quality, dedupe, alt titles, score position) persist to localStorage and flow into the API hooks.
  - All comix.to images go through `proxyImage(url)` → `/api/image?url=...`.

- **`lib/api-spec`** — OpenAPI 3.1 source of truth at `lib/api-spec/openapi.yaml`. Orval generates:
  - `lib/api-client-react` — typed `useQuery` hooks consumed by the frontend.
  - `lib/api-zod` — runtime zod schemas; `src/index.ts` re-exports the conflicting `GetChaptersParams` / `GetMangaDetailsParams` from the types module under `*ParamsType` aliases to avoid clashing with the zod schemas of the same name.
  - Run `pnpm --filter @workspace/api-spec run codegen` after editing the spec.

## Conventions

- Always send `Referer: https://comix.to/` on any outbound request to comix.to (both API and image fetches).
- NSFW genre IDs (`87264, 8, 87265, 13, 87266, 87268`) are excluded as `genres[]=-{id}` query params when `nsfw=false`.
- Manga IDs are `hash_id` (the slug prefix on `/title/{id}-{slug}`), not numeric DB IDs.
- The image proxy whitelists comix.to and a handful of common CDN hosts; reject everything else.
