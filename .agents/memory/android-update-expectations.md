---
name: Android update expectations
description: The user's expectation for updates to already-installed ComiHub Android apps.
---

The user expects compatible ComiHub web changes to reach already-installed Android and iOS apps automatically. They prefer checks on app open/foreground, not a periodic timer, with downloaded bundles applied on the next launch.

**Why:** the user explicitly asked whether downloaded Android apps receive new features when the web and Render versions update from GitHub.

**How to apply:** when changing release or deployment behavior, verify that the signed web bundle advances with production and explain when a native installer is still required.
