---
name: AllManga upstream access
description: AllManga's current public site and API behavior when evaluating a server-side source adapter.
---

AllManga's `allmanga.to` pages are JavaScript shells, while `api.mkissa.net` currently responds with Cloudflare 400/403 to server-side requests. The maintained upstream adapter also needs browser-side JavaScript to extract chapter page data, so a normal server-only MangaSource cannot reliably support search, chapters, or pages.

**Why:** Direct HTTP checks and the upstream adapter both showed that the data path depends on protected API/browser execution rather than stable server-rendered HTML.

**How to apply:** Do not mark AllManga as a supported server source without adding a browser-capable integration or finding a reliable permitted upstream API. It may still be listed as a discoverable extension with a clear unavailable/coming-soon state.