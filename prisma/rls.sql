-- Run once in the Supabase SQL editor AFTER the first migration.
-- Your NestJS API connects as the postgres role (bypasses RLS), so enabling RLS with
-- no policies blocks anyone hitting these tables through Supabase's public REST API.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
