-- ComiHub: enable RLS without changing the current server-side auth/library path.
--
-- The application currently uses:
--   * DATABASE_URL from the backend for Drizzle/Postgres access, and
--   * SUPABASE_SERVICE_KEY for the Supabase session store.
-- Both server-side paths bypass RLS. This migration intentionally does NOT
-- FORCE RLS, so the backend continues to work while browser/anon access is
-- denied by default.
--
-- This migration does not touch auth.users, passwords, sessions, or row data.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Public tables containing account, session, library, and lock-PIN data.
ALTER TABLE public.comihub_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comihub_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_sync ENABLE ROW LEVEL SECURITY;

-- Defense in depth: these tables are not intended for direct browser/PostgREST
-- access. The backend service role and database connection are unaffected.
REVOKE ALL ON TABLE public.comihub_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.comihub_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.library_sync FROM anon, authenticated;

-- Existing "Server only" policies on comihub_users and comihub_sessions are
-- restrictive USING (false) policies. The following blocks make the migration
-- safe to run on a fresh/staging copy as well as the current project.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'comihub_users'
      AND policyname = 'Server only'
  ) THEN
    CREATE POLICY "Server only"
      ON public.comihub_users
      AS RESTRICTIVE
      FOR ALL
      TO public
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'comihub_sessions'
      AND policyname = 'Server only'
  ) THEN
    CREATE POLICY "Server only"
      ON public.comihub_sessions
      AS RESTRICTIVE
      FOR ALL
      TO public
      USING (false);
  END IF;
END
$$;

COMMIT;

-- Verification (run separately after the migration):
-- SELECT schemaname, tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('comihub_users', 'comihub_sessions', 'users', 'library_sync')
-- ORDER BY tablename
-- LIMIT 20;
--
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('comihub_users', 'comihub_sessions', 'users', 'library_sync')
-- ORDER BY tablename, policyname
-- LIMIT 50;
