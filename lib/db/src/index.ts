import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getPool(): pg.Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// Lazy pool — only connects when first used
export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    return (getPool() as any)[prop];
  },
});

// Lazy db — only initialises when first used
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    if (!_db) {
      _db = drizzle(getPool(), { schema });
    }
    return (_db as any)[prop];
  },
});

export * from "./schema";
