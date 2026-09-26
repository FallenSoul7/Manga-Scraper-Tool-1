import { getDb, isDbConfigured } from "../db";
import { logger } from "./logger";

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email        TEXT NOT NULL,
  photo        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS library_sync (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lock feature (idempotent — safe to run on every deploy)
ALTER TABLE users ADD COLUMN IF NOT EXISTS lock_pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lock_pin_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  paypal_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'APPROVAL_PENDING',
  expires_at TIMESTAMPTZ,
  last_event TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function runMigrations() {
  if (!isDbConfigured()) {
    logger.info("DATABASE_URL not set — skipping migrations");
    return;
  }
  try {
    const db = getDb();
    // Use raw sql via the underlying postgres client
    await (db as any).$client?.unsafe(CREATE_SQL);
    logger.info("DB migrations OK");
  } catch (err: any) {
    // drizzle wraps the postgres client; fall back to direct query
    try {
      const postgres = (await import("postgres")).default;
      const sql = postgres(process.env["DATABASE_URL"]!, { ssl: "require", max: 1 });
      await sql.unsafe(CREATE_SQL);
      await sql.end();
      logger.info("DB migrations OK (fallback path)");
    } catch {
      logger.error("DB migrations failed — tables may not exist");
    }
  }
}
