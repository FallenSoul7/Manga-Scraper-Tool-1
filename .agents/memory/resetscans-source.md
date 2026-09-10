---
name: Reset Scans source
description: Live Reset Scans URL and listing/parser constraints.
---

Reset Scans is currently served from `www.resetscans.net`, not the retired `reset-scans.org` domain. Its homepage listing uses `.series-card` elements whose covers are stored in `.series-card-thumb` CSS `background-image` styles instead of `<img>` tags. The live homepage exposes one 20-title listing without a working pagination link; chapter and cover image requests work through the backend proxy when sent with the site referer.

**Why:** Treating the retired domain as a normal Madara source caused misleading “blocked in your region” UI, while parsing only `<img>` tags produced valid titles with empty covers.

**How to apply:** Keep Reset Scans as a dedicated source handler, parse CSS background cover URLs with an `<img>` fallback, avoid claiming a next page unless the upstream site exposes one, and use `https://www.resetscans.net/` as the image referer.