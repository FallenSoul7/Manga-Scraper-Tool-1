import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const DATABASE_URL = process.env["DATABASE_URL"];

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add it to your Render environment variables.",
    );
  }
  if (!_db) {
    const client = postgres(DATABASE_URL, { ssl: "require", max: 5 });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export function isDbConfigured() {
  return !!DATABASE_URL;
}
