---
name: Type contract drift
description: Non-obvious TypeScript boundaries in the API source adapters and web video player.
---

The canonical API source contract is `MangaSource.details`, `chapters`, and `pages`; older AI-generation route names such as `getMangaDetails` are not part of the runtime interface. Keep adapter-specific bulk helpers optional rather than weakening the core contract.

**Why:** The repository contains older callers and generated declarations from different source API revisions. Letting those names drift makes typecheck fail even when the endpoints still work.

**How to apply:** When adding a source or route, type it against `MangaSource` first and translate legacy data shapes at the boundary. Plyr 3.8.4 ships conflicting `export =` and default declarations; the web player uses the runtime default class with a documented TypeScript exception.