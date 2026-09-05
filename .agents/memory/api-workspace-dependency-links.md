---
name: API workspace dependency links
description: Environment-specific failure mode where the API package declares dependencies but its pnpm workspace links point at missing peer-resolved store paths.
---

If the API build reports a declared package such as axios as missing, inspect the workspace links before changing package versions. A filtered online pnpm install can repair stale links from the existing lockfile; the API build must then regenerate its bundled logger worker files before restart.

**Why:** The workspace may retain a symlink to a non-peer-resolved pnpm store path after a partial install, while the lockfile and package declaration remain correct.

**How to apply:** Prefer repairing the API workspace installation and rebuilding over changing dependency versions or externalizing runtime packages.