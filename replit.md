# Comix Lounge

A manga reader web app with a library, browsing sources, reading history, and a multi-source backend scraper.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/comix-web run dev` — run the frontend (port 19597)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS v4 + wouter (routing) + shadcn/ui
- API: Express 5 with axios + cheerio for scraping
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/comix-web/` — React + Vite frontend (manga reader UI)
- `artifacts/api-server/` — Express backend with manga source scrapers
- `artifacts/api-server/src/sources/` — Manga source scrapers (MangaDex, Comick, Madara, etc.)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
- `lib/api-client-react/` — Generated React Query hooks
- `lib/api-zod/` — Generated Zod schemas
- `lib/db/` — Drizzle ORM schema + migrations

## Architecture decisions

- Contract-first API: OpenAPI spec → codegen → Zod schemas + React Query hooks
- wouter for lightweight client-side routing (not Next.js)
- Multi-source manga scraping: each source implements a common interface in `src/sources/`
- Frontend is fully client-rendered (Vite SPA), no SSR

## Product

Comix Lounge is a manga reader app. Users can:
- Browse and manage a personal manga library organized into shelves
- Browse multiple manga sources (MangaDex, Comick.fun, Madara-based sites, etc.)
- Read manga chapters with a built-in reader
- Track reading history and check for updates

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `axios` and `cheerio` must be installed as direct deps on `@workspace/api-server` — they are not in the workspace catalog
- Do NOT run `pnpm dev` at workspace root; use `restart_workflow` or filter-specific commands
- The `.migration-backup/` artifacts have their own (duplicate) workflows registered — ignore those, use only `artifacts/` workflows

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
