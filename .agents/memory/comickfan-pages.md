---
name: ComickFan chapter pages limitation
description: Why ComickFan chapter pages are broken in web/server mode and cannot be fixed.
---

## The problem
ComickFan (comickfan.com) chapter pages are permanently broken in server-side scraping:

1. **HTML is a client-side shell** — the chapter reading page returns 45KB of empty HTML with no images embedded. All image loading happens via client-side JavaScript.
2. **Backend API blocked** — ComickFan uses `api.comick.fun` (and `api.comick.app`) as its backend. Both are protected by Cloudflare bot detection that blocks all server-side HTTP requests regardless of User-Agent or headers.
3. **No internal API** — `comickfan.com` does not expose a chapter-images REST endpoint. Attempted routes `/api/comics/{slug}/chapters/{hid}` and `/api/chapters/{hid}` return 404.
4. **No Next.js buildId** — The homepage returns no `/_next/static/{buildId}` references, ruling out the Next.js data-fetch approach.

## What still works
- Popular/Latest/Search: HTML scraping works (page is SSR)
- Chapter list: `GET /api/comics/{slug}/chapter-list` works and returns chapters with `hash_id`
- Manga details: HTML scraping works

## The fix applied
`pages()` throws a descriptive error directing users to the Mihon/Tachiyomi app instead.

**Why:** The Tachiyomi extension works on Android devices because they have residential IPs and real browser environments that pass Cloudflare's JS challenge. Server environments do not.
