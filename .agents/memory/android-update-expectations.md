---
name: Android update expectations
description: The user's expectation for updates to already-installed ComiHub Android apps.
---

The user expects feature changes shipped to ComiHub's web/backend production to reach already-installed Android apps automatically whenever the change is compatible with the app's native shell.

**Why:** the user explicitly asked whether downloaded Android apps receive new features when the web and Render versions update from GitHub.

**How to apply:** when changing release or deployment behavior, verify that the signed Android web-bundle update advances with production and explain when a native installer is still required.
