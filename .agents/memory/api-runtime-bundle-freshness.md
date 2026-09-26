---
name: API runtime bundle freshness
description: Workflow behavior when API source handlers change or appear missing.
---

The API workflow runs the bundled `dist` output, not the TypeScript source directly. When a source is present in the registry but the API reports that its catalog handler is missing, rebuild the API bundle and restart the API workflow before changing source logic.

**Why:** A stale bundle can omit a newly registered source and produce a misleading catalog-handler error even though the current repository source and registry are correct.

**How to apply:** After source-registry or API source changes, use the package build and restart the active API workflow, then verify the source-specific detail, chapters, and pages endpoints.