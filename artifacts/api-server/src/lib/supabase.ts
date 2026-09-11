import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client — uses service key which bypasses RLS.
// Never expose this key to the frontend.
let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_KEY"];

  if (!url || !key) return null;

  if (!_client) {
    _client = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

export function isSupabaseConfigured() {
  return !!(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_KEY"]);
}
