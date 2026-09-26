---
name: AnimeGG response latency
description: AnimeGG can return valid series HTML slowly enough to look like a Cloudflare failure.
---

AnimeGG series and episode HTML can take roughly 23–30 seconds to return even when the response is valid. A short request timeout causes the source to return its generic Cloudflare fallback and an empty chapter list. Successful HTML should remain reusable through the source cache, including stale-cache fallback when a later request fails.

**Why:** The upstream response time varies by title and network path; One Piece can be fast while Naruto Shippuden is much slower.

**How to apply:** Keep AnimeGG HTML fetch timeouts above the observed slow-response range and preserve the existing successful/stale cache behavior when adjusting its content-loading path. Aggregators that combine AnimeGG with faster sources should override the timeout for AnimeGG only rather than slowing every source.