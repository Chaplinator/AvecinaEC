-- Pruebas de estructura: RLS activo, indices, checks, trigger, siembra de config, privilegios por columna.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- 1-4. RLS activo
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS activo en profiles');
select ok((select relrowsecurity from pg_class where oid = 'public.sectors'::regclass), 'RLS activo en sectors');
select ok((select relrowsecurity from pg_class where oid = 'public.reports'::regclass), 'RLS activo en reports');
select ok((select relrowsecurity from pg_class where oid = 'public.config'::regclass), 'RLS activo en config');

-- 5-7. Indices requeridos
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sectors_h3_cells_gin'
  and indexdef ilike '%using gin%'), 'indice GIN sobre sectors.h3_cells');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sectors_geometry_gist'
  and indexdef ilike '%using gist%'), 'indice GIST sobre sectors.geometry');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'reports_h3_type_created_idx'
  and indexdef ilike '%(h3_cell, type, created_at desc)%'), 'indice compuesto (h3_cell, type, created_at desc) en reports');

-- Usuarios de prueba (como superusuario)
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'schema-a@example.test');

-- 8-9. Trigger de profile
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'el trigger crea el profile al insertar en auth.users');
select is((select trust_score from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 50,
  'trust_score por defecto es 50');

-- 10-15. Checks de reports
select throws_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, provider, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'power', 'out', '8828308281fffff', 'netlife', 'manual', gen_random_uuid())$$,
  '23514', null, 'provider no nulo con type distinto de internet falla');

select throws_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, photo_path, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'power', 'out', '8828308281fffff', 'a/b.jpg', 'manual', gen_random_uuid())$$,
  '23514', null, 'photo_path con type distinto de flood falla');

select throws_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'power', 'out', '-12.0464,-77.0428', 'manual', gen_random_uuid())$$,
  '23514', null, 'h3_cell que no es un indice H3 (p. ej. coordenadas) falla');

select lives_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, provider, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'internet', 'out', '8828308281fffff', 'netlife', 'manual', '11111111-1111-1111-1111-111111111111')$$,
  'report de internet con proveedor valido es aceptado');

select lives_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, photo_path, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'flood', 'flood_level', '8828308281fffff', 'a/b.jpg', 'manual', gen_random_uuid())$$,
  'report de inundacion con foto es aceptado');

select throws_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, provider, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'internet', 'out', '8828308281fffff', 'netlife', 'manual', '11111111-1111-1111-1111-111111111111')$$,
  '23505', null, '(user_id, client_request_id) duplicado falla');

-- 16-17. Siembra de config
select is((select count(*)::int from public.config), 14, 'config tiene las 14 filas sembradas');
select is((select value from public.config where key = 'confirmed_min_yes'), '3'::jsonb, 'confirmed_min_yes = 3');

-- 18-21. Privilegios por columna sobre profiles
select ok(not has_column_privilege('authenticated', 'public.profiles', 'trust_score', 'UPDATE'), 'authenticated sin UPDATE en trust_score');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_banned', 'UPDATE'), 'authenticated sin UPDATE en is_banned');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'phone_verified', 'UPDATE'), 'authenticated sin UPDATE en phone_verified');
select ok(has_column_privilege('authenticated', 'public.profiles', 'locale', 'UPDATE'), 'authenticated con UPDATE en locale');

select * from finish();
rollback;
