---
name: Scrapling browser dependency
description: Runtime dependency and readiness behavior for the Python Scrapling bypass service
---

Scrapling 0.4.x can install successfully while `StealthyFetcher` remains unusable because its browser engine lazily imports `curl_cffi`.

**Why:** A dependency install can appear healthy until the first fetch request, leaving a misleading green health endpoint and hiding the actual deployment failure.

**How to apply:** Keep `curl_cffi` explicit in the bypass service requirements, smoke-test the `StealthyFetcher` import during the image build, and make `/health` report degraded when that import fails.