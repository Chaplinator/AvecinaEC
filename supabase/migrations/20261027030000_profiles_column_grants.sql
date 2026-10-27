-- Profiles: privilegios SELECT por columna para authenticated.
-- Motivo: el grant de tabla completa dejaba a cada usuario leer su propio trust_score e is_banned,
-- lo que delata el "shadow limit" de CLAUDE.md §7 (peso cero sin avisar). Esas columnas solo las lee
-- el servidor con service_role (bypassa RLS y privilegios de authenticated).
-- Verificado: ninguna funcion security definer (solo handle_new_user, que inserta), vista ni trigger
-- depende de que authenticated lea trust_score/is_banned.
-- Se mantienen: grant update (locale) y las politicas RLS de "solo la fila propia". anon sin acceso.
-- Consecuencia: "select *" sobre profiles desde authenticated falla con 42501; listar columnas.

revoke select on table public.profiles from authenticated;
grant select (id, created_at, locale, phone_verified) on table public.profiles to authenticated;

-- Plan de rollback (no se aplica automaticamente):
--   revoke select (id, created_at, locale, phone_verified) on table public.profiles from authenticated;
--   grant select on table public.profiles to authenticated;
