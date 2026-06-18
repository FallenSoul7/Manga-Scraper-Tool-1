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
    } catch (err2) {
      logger.error({ err: err2 }, "DB migrations failed — tables may not exist");
    }
  }
}
