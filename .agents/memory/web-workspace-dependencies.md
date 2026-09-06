---
name: Web workspace dependency repair
description: Environment-specific guidance for repairing dependencies in the Comix web workspace.
---

When a dependency is already declared and locked for the web artifact but is missing from local node_modules, a filtered pnpm install for the web workspace repairs the link without changing the dependency graph. The package installer may otherwise target the monorepo root.

**Why:** The workspace package installer rejected workspace flags and attempted to add the dependency at the root, while the artifact’s frozen lockfile already contained the correct package.

**How to apply:** Prefer the existing lockfile and the web workspace filter for this class of install repair. For packages with CommonJS-style typings consumed through Vite, keep TypeScript synthetic default/import interop enabled.