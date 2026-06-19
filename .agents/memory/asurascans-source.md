---
name: AsuraScans source implementation
description: How AsuraScans (en.asurascans) is implemented — API endpoints, slug encoding, and pages approach.
---

## API base
`https://api.asurascans.com/api` — public, no auth needed, works from server.

## Key endpoints
- Popular/Latest/Search: `GET /series?offset=N&limit=20&sort=popular|latest&search=query`
- Detail: `GET /series/{apiSlug}` → `{data:{series:{slug,title,cover,public_url,...}}}`
- Chapters: `GET /series/{apiSlug}/chapters` → `{data:[{id,number,title,slug,published_at}]}`
- Tags: `GET /genres` → `{data:[{slug,name}]}`

## Slug encoding — critical
The API uses `slug` (e.g. `reformation-of-the-deadbeat-noble`) but chapter web URLs require `public_url` slug (e.g. `reformation-of-the-deadbeat-noble-19cdf401`). These differ by a random suffix.

**How to apply:** In `chapters()`, call `GET /series/{apiSlug}` first to read `public_url`, extract the last path segment, encode as `{publicSlug}|||{chapterNumber}` in each chapter ID. In `pages()`, split on `|||` to recover the public slug for the HTML URL.

## Pages
Chapter HTML page `https://asurascans.com/comics/{publicSlug}/chapter/{N}` is Astro SSR (262KB). Pages are extracted via Astro embedded JSON or direct img DOM parsing. No auth needed for free chapters.

**Why:** AsuraScans uses Astro framework with SSR — page images are embedded in the HTML, not fetched via a separate API.
