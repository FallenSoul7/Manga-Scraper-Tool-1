---
name: Koofr local URL proxy bug
description: proxyImage() wraps all thumbnail URLs in /api/image, which rejects relative /api/ paths — must skip wrapping for local paths.
---

# Koofr Local URL Proxy Issue

## The Rule
`proxyImage()` in `utils.ts` must skip wrapping URLs that start with `/api/` or `/public/`. These are already served by the same origin; wrapping them in `/api/image?url=...` causes the image route's `isSafeUrl()` validator to reject them (no `http://` scheme = invalid URL).

**Why:** The image proxy is designed for external URLs only. Internal API paths like `/api/koofr/proxy?path=...` and static paths like `/public/koofr-zip-cover.png` are same-origin and need no proxy.

**How to apply:** Any time a source returns thumbnail URLs that are relative API paths, `proxyImage` will silently break them unless this guard is in place.

## Koofr-specific fixes applied

- Video file covers: use `/public/koofr-video-cover.svg` placeholder (can't render video stream as `<img>`)
- `isVideoUrl` in reader: must include `.mov|mkv|avi` not just `.mp4|webm|ogg`
- "Watch" vs "Read": decode manga ID (base64url path) to detect video extension; show "Watch" for Koofr video IDs
- Koofr proxy in `app.ts`: forwards HTTP Range headers to Koofr API so browsers can seek in videos
- Build fix: `postgres`, `passport`, `passport-google-oauth20`, `express-session`, `connect-pg-simple`, `unzipper`, `@supabase/supabase-js` must be in esbuild `external` list in `build.mjs`
