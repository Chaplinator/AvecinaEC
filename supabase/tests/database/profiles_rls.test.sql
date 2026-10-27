-- RLS y privilegios de profiles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'prof-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'prof-b@example.test');

-- ===== Usuario A =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'A lee su propio profile');
select is((select count(*)::int from public.profiles), 1, 'A no ve el profile de B (solo 1 fila visible)');

-- Columnas visibles vs ocultas (el shadow limit del §7 no debe delatarse)
select lives_ok($$select id, created_at, locale, phone_verified from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'A lee sus columnas permitidas');
select throws_ok($$select trust_score from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede leer trust_score');
select throws_ok($$select is_banned from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede leer is_banned');
select throws_ok($$select * from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede hacer select * sobre profiles');

-- A intenta modificar el profile de B: RLS filtra, 0 filas afectadas
do $$
declare n int;
begin
  update public.profiles set locale = 'xx' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  perform set_config('test.rows', n::text, true);
end $$;
select is(current_setting('test.rows')::int, 0, 'A no modifica el profile de B (0 filas afectadas)');

do $$
declare n int;
begin
  update public.profiles set locale = 'en' where id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  perform set_config('test.rows', n::text, true);
end $$;
select is(current_setting('test.rows')::int, 1, 'A si actualiza su propio locale');

select throws_ok($$update public.profiles set trust_score = 100 where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede cambiar su trust_score');
select throws_ok($$update public.profiles set is_banned = true where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede cambiar is_banned');
select throws_ok($$update public.profiles set phone_verified = true where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede cambiar phone_verified');
select throws_ok($$update public.profiles set id = '00000000-0000-0000-0000-0000000000c3' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede cambiar su id');
select throws_ok($$insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000c3')$$,
  '42501', null, 'A no puede insertar profiles');
select throws_ok($$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'A no puede borrar profiles');
select throws_ok($$select public.handle_new_user()$$,
  '42501', null, 'A no puede invocar handle_new_user()');

-- ===== anon =====
reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

select throws_ok($$select * from public.profiles$$, '42501', null, 'anon no lee profiles');
select throws_ok($$select id from public.profiles$$, '42501', null, 'anon no lee ni id de profiles');
select throws_ok($$update public.profiles set locale = 'xx'$$, '42501', null, 'anon no actualiza profiles');

-- ===== service_role (servidor): si lee las columnas ocultas =====
reset role;
set local role service_role;
select is((select trust_score from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 50,
  'service_role lee trust_score');
select is((select is_banned from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), false,
  'service_role lee is_banned');

-- ===== Verificacion final como superusuario =====
reset role;
select is((select locale from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'es',
  'el locale de B no cambio');
select is((select locale from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'en',
  'el locale de A cambio a en');
select is((select trust_score from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 50,
  'el trust_score de A sigue en 50');

select * from finish();
rollback;
