---
name: Rule34 Paheal limits
description: Upstream tag and media limitations for the Rule34 extension.
---

The Rule34 extension is backed by rule34.paheal.net because rule34.xxx is blocked in this environment. Paheal currently returns no posts for `rimjob`, `rim_job`, or `rim-job`, and those slugs are absent from the scraped tag catalog.

**Why:** The source cannot return results for a tag that Paheal does not index; adding a UI alias alone would create a filter that always returns an empty list.

**How to apply:** Preserve the app's explicit empty-results behavior for unavailable tags. Only add a tag alias if a live Paheal endpoint confirms a different indexed slug.