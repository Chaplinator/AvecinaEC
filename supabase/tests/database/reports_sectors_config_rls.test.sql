-- RLS y privilegios de reports, sectors y config.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'rep-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'rep-b@example.test');

insert into public.reports (user_id, type, status_value, h3_cell, source, client_request_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'power', 'out', '8828308281fffff', 'manual', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000a1', 'water', 'out', '8828308281fffff', 'manual', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000b2', 'power', 'out', '8828308281fffff', 'manual', gen_random_uuid());

insert into public.sectors (name, city) values ('Sector de prueba', 'Guayaquil');

-- ===== Usuario A =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.reports), 2, 'A lee solo sus 2 reports');
select is((select count(*)::int from public.reports where user_id = '00000000-0000-0000-0000-0000000000b2'), 0,
  'A no lee reports de B');
select throws_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'power', 'out', '8828308281fffff', 'manual', gen_random_uuid())$$,
  '42501', null, 'A no inserta reports directamente');
select throws_ok($$update public.reports set h3_cell = '8828308283fffff'$$, '42501', null, 'A no actualiza reports');
select throws_ok($$delete from public.reports$$, '42501', null, 'A no borra reports');

select is((select count(*)::int from public.sectors), 1, 'A lee sectors');
select throws_ok($$insert into public.sectors (name, city) values ('x', 'y')$$, '42501', null, 'A no inserta sectors');
select throws_ok($$update public.sectors set name = 'z'$$, '42501', null, 'A no actualiza sectors');

select throws_ok($$select * from public.config$$, '42501', null, 'A no lee config');
select throws_ok($$insert into public.config (key, value) values ('x', '1')$$, '42501', null, 'A no inserta en config');
select throws_ok($$update public.config set value = '99'$$, '42501', null, 'A no actualiza config');

-- ===== Usuario B =====
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000b2', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.reports), 1, 'B lee solo su 1 report');

-- ===== anon =====
reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok($$select * from public.reports$$, '42501', null, 'anon no lee reports');
select throws_ok(
  $$insert into public.reports (user_id, type, status_value, h3_cell, source, client_request_id)
    values ('00000000-0000-0000-0000-0000000000a1', 'power', 'out', '8828308281fffff', 'manual', gen_random_uuid())$$,
  '42501', null, 'anon no inserta reports');
select is((select count(*)::int from public.sectors), 1, 'anon lee sectors');
select throws_ok($$insert into public.sectors (name, city) values ('x', 'y')$$, '42501', null, 'anon no escribe en sectors');
select throws_ok($$select * from public.config$$, '42501', null, 'anon no lee config');

reset role;
select * from finish();
rollback;
