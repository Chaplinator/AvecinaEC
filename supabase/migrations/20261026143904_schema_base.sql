-- Migracion: schema_base (Semana 1)
-- Tablas: profiles, sectors, reports, config. Todas con RLS + privilegios minimos.
-- Modelo de acceso: el cliente (anon/authenticated) casi no escribe nada; las escrituras
-- sensibles las hace la API con service_role (que ignora RLS) segun CLAUDE.md seccion 5.

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  phone_verified boolean not null default false,
  trust_score    integer not null default 50 check (trust_score between 0 and 100),
  is_banned      boolean not null default false,
  locale         text not null default 'es' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

alter table public.profiles enable row level security;

-- Defensa en profundidad: quitar privilegios por defecto y otorgar solo lo minimo.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
-- Privilegio por columna: el usuario SOLO puede actualizar locale.
-- trust_score, is_banned y phone_verified quedan sin UPDATE (error 42501 si lo intenta).
grant update (locale) on table public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Sin politica de insert (lo hace el trigger) ni de delete (se borra por cascade desde auth.users
-- o por la API con service_role). anon: sin acceso.

-- Trigger: crea el profile al registrarse (incluye usuarios anonimos).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

-- Nadie del cliente debe poder invocarla como RPC; el trigger se ejecuta igualmente.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- sectors
-- ---------------------------------------------------------------------------
create table public.sectors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  city        text not null check (char_length(city) between 1 and 100),
  h3_cells    text[] not null default '{}',
  geometry    extensions.geometry(MultiPolygon, 4326),
  parent_zone text,
  unique (city, name)
);

alter table public.sectors enable row level security;

revoke all on table public.sectors from anon, authenticated;
grant select on table public.sectors to anon, authenticated;

create policy sectors_select_public on public.sectors
  for select to anon, authenticated
  using (true);

-- Sin politicas (ni privilegios) de insert/update/delete: nadie del cliente escribe sectores.
-- Se cargan por migracion/seed o con service_role.

create index sectors_h3_cells_gin on public.sectors using gin (h3_cells);
create index sectors_geometry_gist on public.sectors using gist (geometry);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
-- Futuro: particionar por rango de created_at (mensual) al superar ~10M filas (CLAUDE.md 14).
-- Al particionar, la PK y el unique deberan incluir created_at; planificarlo en esa migracion.
-- Retencion: borrar/anonimizar a los reports_retention_days (config). Ver indice por created_at.
create table public.reports (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  type              text not null check (type in ('power', 'water', 'internet', 'flood')),
  status_value      text not null check (status_value in ('out', 'back', 'flood_level')),
  -- H3 resolucion 8 ('88...') en general; resolucion 10 ('8a...') solo para inundacion (calle, CLAUDE.md 6).
  h3_cell           text not null check (h3_cell ~ '^(88|8a)[0-9a-f]{13}$'),
  provider          text check (provider in ('netlife', 'cnt', 'claro', 'xtrim', 'otro')),
  photo_path        text check (char_length(photo_path) <= 500),
  created_at        timestamptz not null default now(),
  source            text not null check (source in ('manual', 'confirmation', 'auto_detect')),
  client_request_id uuid not null,
  constraint reports_user_request_unique unique (user_id, client_request_id),
  constraint reports_provider_only_internet check (provider is null or type = 'internet'),
  constraint reports_photo_only_flood check (photo_path is null or type = 'flood'),
  constraint reports_h3_res10_only_flood check (left(h3_cell, 2) <> '8a' or type = 'flood')
);

alter table public.reports enable row level security;

revoke all on table public.reports from anon, authenticated;
grant select on table public.reports to authenticated;

create policy reports_select_own on public.reports
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Sin politicas ni privilegios de insert/update/delete para anon/authenticated:
-- el cliente nunca escribe directo (CLAUDE.md 5); la API usa service_role.
-- anon: sin acceso.

create index reports_h3_type_created_idx on public.reports (h3_cell, type, created_at desc);
create index reports_user_created_idx on public.reports (user_id, created_at desc);
create index reports_created_at_idx on public.reports (created_at);

-- ---------------------------------------------------------------------------
-- config (solo servidor)
-- ---------------------------------------------------------------------------
create table public.config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.config enable row level security;

revoke all on table public.config from anon, authenticated;

-- Politica explicita de denegacion total para el cliente (service_role ignora RLS).
create policy config_deny_client on public.config
  for all to anon, authenticated
  using (false)
  with check (false);

insert into public.config (key, value, description) values
  ('suspected_min_users', '2', 'Usuarios distintos minimos para marcar un incidente como sospechado'),
  ('suspected_window_minutes', '15', 'Ventana en minutos para contar reportes hacia sospechado'),
  ('confirmed_min_yes', '3', 'Votos si minimos para confirmar'),
  ('confirmed_yes_ratio', '0.6', 'Proporcion minima si/(si+no) para confirmar'),
  ('confirm_notifications_max_per_user_per_day', '3', 'Maximo de preguntas de confirmacion por usuario por dia'),
  ('quiet_hours', '{"start": "22:00", "end": "06:00"}', 'Horario silencioso por defecto para notificaciones'),
  ('expire_suspected_minutes', '45', 'Minutos tras los cuales un sospechado sin confirmar pasa a expired'),
  ('expire_confirmed_inactive_hours', '12', 'Horas sin actividad antes de volver a preguntar en un confirmado'),
  ('flood_min_reports', '3', 'Reportes minimos para confirmar una inundacion'),
  ('flood_expire_hours', '6', 'Horas tras las cuales expira una inundacion sin renovarse'),
  ('resolve_back_ratio', '0.5', 'Proporcion de respuestas ya volvio para resolver'),
  ('k_anonymity_min_users', '3', 'Usuarios distintos minimos para mostrar un incidente'),
  ('reports_retention_days', '90', 'Dias de retencion de reports crudos'),
  ('h3_resolution', '8', 'Resolucion H3 para agregacion');

-- ---------------------------------------------------------------------------
-- PLAN DE ROLLBACK (ver supabase/rollback/20261026143904_schema_base.sql)
--   drop trigger on_auth_user_created on auth.users;
--   drop function public.handle_new_user();
--   drop table public.reports, public.sectors, public.config, public.profiles;
--   (postgis se deja instalada; drop extension postgis solo si nada mas la usa)
-- ---------------------------------------------------------------------------
