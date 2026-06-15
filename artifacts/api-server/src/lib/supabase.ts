import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let _client: SupabaseClient | null = null;

/**
 * Returns a Supabase client initialised from env vars.
 * Throws a clear error if SUPABASE_URL / SUPABASE_SERVICE_KEY are not set,
 * but only when an AI route is actually called — not at server startup.
 *
 * Required Supabase tables (run once in the SQL editor):
 *
 *   create table if not exists ai_sessions (
 *     key        text primary key,
 *     manga      jsonb not null,
 *     created_at timestamptz default now()
 *   );
 *
 *   create table if not exists ai_results (
 *     filename   text primary key,
 *     data       text not null,
 *     created_at timestamptz default now()
 *   );
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set in environment variables.",
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
