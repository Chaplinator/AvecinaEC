-- Rollback de 20261026143904_schema_base.sql. NO se aplica automaticamente.
-- DESTRUCTIVO: borra todos los datos de estas tablas. Confirmar antes de ejecutar.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.reports;
drop table if exists public.sectors;
drop table if exists public.config;
drop table if exists public.profiles;
-- La extension postgis se conserva; si nada mas la usa: drop extension postgis;
-- Ademas, borrar la fila en supabase_migrations.schema_migrations (version 20261026143904).
