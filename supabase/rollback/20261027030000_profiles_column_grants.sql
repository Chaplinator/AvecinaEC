-- Rollback de 20261027030000_profiles_column_grants.sql. NO se aplica automaticamente.
-- Vuelve al grant de tabla completa: authenticated volveria a poder leer su propio trust_score e is_banned
-- (delata el shadow limit del §7). Solo para emergencias.
revoke select (id, created_at, locale, phone_verified) on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
-- Ademas, borrar la fila en supabase_migrations.schema_migrations (version 20261027030000).
