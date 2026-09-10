---
name: Reset Scans source
description: Live Reset Scans URL and listing/parser constraints.
---

Reset Scans is currently served from `www.resetscans.net`, not the retired `reset-scans.org` domain. Its homepage listing uses `.series-card` elements whose covers are stored in `.series-card-thumb` CSS `background-image` styles instead of `<img>` tags. Some valid entries intentionally use `series-no-thumb`, and detail pages use the generic `manganex_wallpaper.jpg`; use that branded image rather than inventing a remote cover. The live homepage exposes one 20-title listing without a working pagination link; chapter and cover image requests work through the backend proxy when sent with the site referer.

**Why:** Treating the retired domain as a normal Madara source caused misleading “blocked in your region” UI, while parsing only `<img>` tags produced valid titles with empty covers. The upstream public media API is disabled, so missing artwork cannot be recovered reliably from the source.

**How to apply:** Keep Reset Scans as a dedicated source handler, parse CSS background cover URLs with an `<img>` fallback, use the branded wallpaper for `series-no-thumb` entries, use the browser bypass fallback for detail/chapter/page HTML, avoid claiming a next page unless the upstream site exposes one, and use `https://www.resetscans.net/` as the image referer.