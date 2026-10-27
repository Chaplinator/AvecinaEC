# CLAUDE.md — Avecina (antes "SeFue", nombre provisional)

> Este archivo es la fuente de verdad del proyecto para Claude Code. Léelo completo antes de cualquier tarea.
> Si una decisión contradice este documento, pregunta antes de implementarla. Si una decisión cambia el producto, actualiza este archivo en el mismo PR.

---

## 1. Qué es el producto

App colaborativa que muestra **en tiempo real** qué sectores de una ciudad están sin **luz, agua o internet**, o tienen **calles inundadas**. Empieza en Guayaquil y luego se expande al resto de Ecuador.

**Problema que resuelve:** en Ecuador los cortes de luz y agua no programados son frecuentes. Las empresas no informan a tiempo y los cronogramas oficiales no se cumplen. Hoy la gente pregunta en Reddit, X y grupos de WhatsApp "¿se fue la luz solo en mi casa?". No existe una fuente confiable en tiempo real.

**Referentes:** EskomSePush (Sudáfrica, +10M usuarios; reportes comunitarios de cortes de luz, agua e internet) y GridWatch / nLine (Berkeley; detección automática de apagones con sensores del celular).

**Diferenciador:** el ciclo de confirmación comunitaria.
1. **Disparador:** alguien reporta, o (fase 2, Android nativo) el celular detecta solo que dejó de cargar sin moverse.
2. **Confirmación:** a los usuarios del mismo sector les llega "¿Se te fue la luz?" → Sí / No / No estoy en casa.
3. **Cierre:** más tarde, "¿Ya volvió?". Así se calcula la duración real de cada corte por sector y se construye un historial que nadie más tiene.

**Urgencia:** el mayor impacto del fenómeno de El Niño se espera entre noviembre 2026 y marzo 2027. El MVP debe estar en producción en **semanas**. Prioriza lanzar algo sólido y pequeño sobre algo grande e incompleto.

---

## 2. Alcance

### MVP (fase 1 — PWA)
- Mapa de la ciudad con sectores coloreados según estado: luz, agua, internet, inundación.
- Reporte en 2 toques: tipo de incidente → "en mi ubicación" (o elegir sector).
- Internet: el usuario elige su proveedor (Netlife, CNT, Claro, Xtrim, otro).
- Inundación: foto opcional + nivel aproximado (charco / tobillo / rodilla / no pasa carro).
- Flujo de confirmación con notificaciones push ("¿Se te fue la luz?", "¿Ya volvió?").
- Suscripción a sectores (casa, trabajo, casa de los papás).
- Historial por sector: cortes en los últimos 30 días y duración promedio.
- Instalación como PWA (Android y iPhone con iOS 16.4+ agregada a pantalla de inicio).
- Funcionamiento con conexión mala: si hay apagón, el usuario está con datos móviles y poca batería.

### Fuera del MVP (no implementar sin aprobación)
- Reportes de robos, inseguridad o personas. **Prohibido** por riesgo legal, de moderación y para quien reporta.
- Vías cerradas en ciudad (Waze ya lo cubre). Evaluar solo carreteras interprovinciales en fase 2.
- Chat entre usuarios.
- Pagos y suscripciones.

### Fase 2
- App Android nativa (React Native / Expo) con detección automática: evento de desconexión de carga + acelerómetro sin movimiento + pérdida del WiFi de casa → pregunta de confirmación. Si el router sigue visible pero no hay internet → posible caída del proveedor.
- Importar cronogramas oficiales de cortes (CNEL, Empresa Eléctrica Quito, Interagua) cuando se publiquen.
- Panel B2B: datos agregados para aseguradoras, inmobiliarias, ISPs y medios.

---

## 3. Principios de producto (no negociables)

1. **Mobile first, Android gama baja first.** Se prueba en un Android de 2 GB de RAM con 3G lento.
2. **Pesar poco.** El usuario está con datos móviles y batería baja durante un apagón.
3. **Reportar en menos de 5 segundos.** Sin registro obligatorio para el primer reporte.
4. **Nunca mostrar a un individuo.** El mapa solo muestra datos agregados por zona. Nunca un punto de una casa.
5. **Confianza sobre volumen.** Un incidente se muestra solo cuando está validado (ver §7).
6. **No reemplaza canales oficiales.** Mostrar siempre: "Para emergencias llama al ECU 911".
7. **Español neutro latinoamericano**, tono claro y cercano, sin regionalismos fuertes.

---

## 4. Stack

| Capa | Tecnología | Motivo |
|---|---|---|
| Frontend | **Next.js (App Router) + TypeScript estricto** como PWA | SSR/ISR, rendimiento, despliegue simple |
| Estilos | Tailwind CSS | CSS mínimo en producción |
| Mapa | **MapLibre GL** (o Leaflet si el bundle pesa demasiado) + teselas vectoriales | Open source, sin costo por carga |
| Celdas geográficas | **H3** (`h3-js`), resolución 8 (~0,7 km²) para agregar | Escalable, anónimo, fácil de agregar |
| Backend / BD | **Supabase**: Postgres + PostGIS + Auth + Realtime + Storage + Edge Functions | RLS nativo, tiempo real, plan gratuito |
| Validación | **Zod** en el servidor; el cliente comparte solo tipos y constantes (`src/lib/report-types.ts`) | Zod pesa ~13 KB en el navegador y el presupuesto de JS inicial está casi agotado (decisión 26/10/2026) |
| Rate limiting y caché | **Upstash Redis** + `@upstash/ratelimit` | Serverless, compatible con Vercel |
| Colas | **Upstash QStash** o colas de Supabase (pgmq) | Envío masivo de notificaciones sin bloquear |
| Push | Web Push (VAPID) con `web-push` | Gratis, funciona en Android e iOS PWA |
| Hosting | **Vercel** (frontend + API) + **Supabase** (datos) | CDN global, compresión y previews automáticos |
| Monitoreo de errores | **Sentry** | Errores en cliente y servidor |
| Uptime / logs | **Better Stack** (o similar) | Alertas si la app cae |
| Analítica | **PostHog** (modo privado, sin grabación de sesiones) | Métricas de producto respetando privacidad |
| Testing | Vitest, Playwright, pgTAP (pruebas de RLS), k6 (carga) | |
| CI/CD | GitHub Actions + Vercel | |

**Sobre el hosting existente:** un hosting compartido tipo reseller/cPanel **no es adecuado** para esta app (no soporta bien Next.js, tiempo real ni picos de tráfico). Puede seguir usándose para correo del dominio o una landing estática. La app vive en Vercel + Supabase.

---

## 5. Arquitectura

```
[PWA Next.js en Vercel Edge/CDN]
   │  lecturas: mapa agregado (cacheado en CDN + Redis, 15–30 s)
   │  escrituras: /api/v1/* (validación Zod + rate limit + auth)
   ▼
[API Routes / Route Handlers]  ──►  [Upstash Redis: rate limit + caché]
   │
   ▼
[Supabase Postgres + PostGIS + RLS]
   │  trigger / job: agrega reportes → incidentes por celda H3
   ▼
[Supabase Realtime: canal por celda/sector con estado AGREGADO]
   │
   ▼
[Cola (QStash/pgmq) → Edge Function → Web Push en lotes]
```

**Reglas de arquitectura:**
- El cliente **nunca** escribe directo en tablas sensibles. Toda escritura pasa por la API (`/api/v1`) o por funciones RPC con `security definer` revisadas.
- El tiempo real transmite **estado agregado por sector**, nunca reportes individuales.
- La `service_role key` de Supabase **solo** existe en el servidor. Nunca en el bundle del cliente ni en variables `NEXT_PUBLIC_*`.
- Toda la lógica de negocio crítica (validación de incidentes, umbrales) vive en el servidor o en la BD, nunca solo en el cliente.

---

## 6. Modelo de datos (inicial)

Usa migraciones versionadas con Supabase CLI (`supabase/migrations`). **Nunca** cambies el esquema de producción a mano.

- `profiles` — id (= auth.uid), created_at, phone_verified (bool), trust_score (int, default 50), is_banned, locale.
- `sectors` — id, name (ej. "Alborada 5ta etapa"), city, h3_cells (text[]), geometry (PostGIS), parent_zone.
- `user_places` — id, user_id, label (casa/trabajo/otro), h3_cell (res 8; **no** coordenadas exactas), notify (bool).
- `reports` — id, user_id, type (`power|water|internet|flood`), status_value (`out|back|flood_level`), h3_cell, provider (nullable, solo internet), photo_path (nullable), created_at, source (`manual|confirmation|auto_detect`), client_request_id (idempotencia, único por usuario), net_hash (nullable; ver abajo).
- `incidents` — id, type, h3_cell, sector_id, provider, state (`suspected|confirmed|resolved|expired`), started_at, confirmed_at, resolved_at, report_count, distinct_users, confidence (0–1).
- `confirmations` — id, incident_id, user_id, answer (`yes|no|away`), net_hash (nullable), created_at.
- `push_subscriptions` — id, user_id, endpoint, keys (cifrado), created_at, last_success_at, failures.
- `notification_log` — id, user_id, incident_id, kind, sent_at (para límites anti-spam).
- `audit_log` — acciones administrativas y de moderación.

**Ubicación:** el cliente convierte lat/lng a celda H3 res 8 **antes** de enviarla. El servidor nunca guarda coordenadas exactas de un usuario. Las fotos de inundación sí pueden llevar una ubicación más fina (H3 res 10) porque describen la calle, no la casa.

**Índices:** `(h3_cell, type, created_at desc)` en reports; `(state, type, h3_cell)` en incidents; índice GIST en geometrías.

**Retención:** reports crudos se borran o anonimizan a los **90 días**; incidents agregados se conservan como historial.

**`net_hash` (decisión del 26/10/2026):** `HMAC-SHA256(clave_diaria, red)` con red = IP /24 (IPv6 /56), guardado en reportes, confirmaciones y altas de sesión anónima. La IP sale solo de la cabecera fijada por Vercel, nunca de cabeceras del cliente; sin IP válida queda NULL. La clave diaria es `HKDF(secreto_net_hash, fecha_EC)` (el secreto es distinto de los demás y nunca está en la BD), y el hash se trunca a 64 bits. La clave rota a las 04:00 hora de Ecuador (entre 03:30 y 04:30 se comparan la anterior y la actual). A los **7 días** se pone en NULL (job con prueba; los reportes siguen 90 días) y también se borra al eliminar la cuenta. El alta anónima se registra en la tabla `anon_signups` (id, user_id, net_hash, created_at) desde `/api/v1`, porque ocurre en Supabase Auth. Es pseudonimización, no anonimización, mientras exista `user_id` en la misma fila; los backups lo retienen más de 7 días y la política de privacidad debe decirlo. Solo sirve para agrupar cuentas de una misma red (§7, §12); nunca se expone ni se escribe en logs. La tabla de votos usa un `person_key` aleatorio por incidente (no derivado del hash), para que el borrado a 7 días no deje rastro.

---

## 7. Lógica de incidentes (núcleo del producto)

Parametrizable en una tabla `config` (no hardcodear umbrales):

- **Sospechado:** ≥2 usuarios distintos reportan el mismo tipo en la misma celda o su disco (`gridDisk` k=1, 7 celdas) en 15 minutos. Es un estado **interno**: nunca se muestra en el mapa (ver k-anonimato, §10).
- **Disparo de confirmación:** al pasar a sospechado, se pregunta a los usuarios suscritos en esa celda y vecinas (máximo N por incidente, muestreo aleatorio para no saturar).
- **Confirmado** (decisión del 26/10/2026; especificación y simulación en `docs/specs/incidentes-umbrales.md`): ≥3 personas distintas con "sí" contadas en el disco de la celda (`gridDisk` k=1) sobre los votos de los últimos **60 min**, y proporción sí/(sí+no) ≥ 0,6. El peso del voto depende de `trust_score` y del teléfono verificado. Protecciones aprobadas: (a) **ancla**: al menos 1 "sí" de una persona con cuenta de más de 24 h cuyo lugar suscrito (de más de 24 h) o cuyo reporte está en la propia celda; (b) **espera mínima de 5 min** tras pasar a sospechado; (c) el "no" de una persona cuya celda no es la del incidente pesa **0,5**; (d) la pregunta se envía **primero a los suscritos de la propia celda**, completando con el resto del res 7 (decisión del 26/10/2026: sube la visibilidad de cortes de una celda del 29 % al 46 % y baja del 54 % al 16 % las zonas falsas con 3 cuentas), con texto neutro que no nombra celda ni sector, retraso aleatorio de 0 a 2 min y **relleno obligatorio** de suscritos de celdas sin reportes (nunca 0, falla cerrado), para que recibirla no pruebe que hay reportes cerca; máximo 1 destinatario por `net_hash` por incidente. "No estoy en casa" no suma ni resta.
- **Qué se muestra:** la celda res 8 si hay ≥3 personas acumuladas en su disco; si no, la celda padre res 7 completa; si ninguna cumple, no se muestra. Las zonas son siempre una celda H3 fija, con histéresis (volver a res 8 exige ≥5 personas sostenidas 10 min y 30 min de permanencia en res 7) y cambios publicados en cubos de 5 min. Nunca se muestran conteos menores a 3.
- **Defensa por red:** dentro de un incidente, las cuentas con el mismo `net_hash` cuentan como UNA persona; mientras no exista verificación por teléfono (OTP, después del lanzamiento), aplica a todas las cuentas. Con ≥5 cuentas nuevas de una misma red en 60 min se dispara solo una **alerta**: no cambia pesos por sí sola (castigaría a usuarios reales en el pico, con los datos móviles compartidos). Las cuentas de menos de 24 h no cuentan para el k ni para el muestreo de preguntas, y su "no" pesa 0,5. Un lugar suscrito nuevo o cambiado no cuenta como ancla ni como voto hasta pasadas 24 h.
- **Resolución:** "¿Ya volvió?" a quienes confirmaron **y también a suscritos de la celda que no votaron**, después de 30–60 min y luego cada hora; resuelto cuando ≥3 personas distintas (dedup por red, cuentas de más de 24 h) responden que volvió o envían `back` y la proporción es ≥0,6, simétrico a confirmar; un solo reporte `back` nunca cierra un incidente, y "todavía sin luz" cuenta como "no" y renueva la visibilidad.
- **Retracción** (decisión del 26/10/2026): tras confirmar, si llegan ≥3 "no" de personas de la propia celda (cuenta y lugar de más de 24 h, dedup por red) y la proporción sí/(sí+no) baja de 0,4, el incidente pasa a `expired` y deja de mostrarse. Tope de visibilidad: 12 h sin un "sí" nuevo de ≥2 personas distintas de cuentas de más de 24 h, con un techo absoluto de 48 h (luz y agua) tras el cual se exige la confirmación completa otra vez; así un incidente falso no vive para siempre. Los contadores se materializan en el incidente: borrar cuentas nunca retracta, resuelve ni oculta (§10). Detalle y casos borde en la especificación.
- **Expiración:** sospechado sin confirmar en **60 min** (antes 45, alineado con la ventana de votos; decisión del 26/10/2026) → `expired`. Confirmado sin actividad en 12 h → se pregunta de nuevo antes de cerrar.
- **Internet:** los incidentes se agrupan por proveedor. Una caída de Netlife en una celda no marca caída de CNT.
- **Horario nocturno (22:00–06:00):** no salen preguntas push, así que no llegan "no" de vecinos y la defensa se debilita. Para publicar de noche se exigen **5 personas o 2 anclas**; las preguntas de luz y agua se permiten hasta las 23:00 (decisión del 26/10/2026).
- **Verificación por teléfono (OTP):** se implementa después del lanzamiento; hasta entonces no existe la exención de la defensa por red.
- **Duración y color:** los cortes se pintan según el tiempo transcurrido: amarillo hasta 2 h, naranja de 2 a 4 h, rojo después de 4 h (umbrales en `config`). Ver §18.
- **Inundación:** se confirma con ≥3 reportes de usuarios distintos (alineado con el k-anonimato del §10; decisión del 26/10/2026); expira en 6 h si nadie lo renueva. Un reporte con foto de usuario con trust alto se muestra solo como "reporte sin confirmar" (no cuenta como incidente ni como zona afectada) hasta que lo respalde otro usuario.
- **Trust score:** sube cuando tus reportes coinciden con incidentes confirmados; baja con reportes que nadie confirma. Usuarios con score muy bajo quedan con peso cero, sin avisarles (shadow limit).

---

## 8. Notificaciones

- Máximo **3 preguntas de confirmación por usuario por día** y 1 por incidente.
- Horario silencioso por defecto 22:00–06:00 (configurable), excepto inundación severa en su sector y las preguntas de luz y agua hasta las 23:00 (§7).
- Textos cortos y accionables, **sin nombrar celda ni sector** para no revelar que hay reportes cerca (§7): "¿Tienes luz ahora en tu casa? Responde con un toque".
- Envío por cola en lotes, con reintentos y backoff. Eliminar suscripciones que fallen 3 veces seguidas (410 Gone).
- Registrar todo en `notification_log` para métricas de entrega y respuesta.

---

## 9. Seguridad

### Autenticación
- **Auth anónima de Supabase** (cero fricción) protegida con **Cloudflare Turnstile** (captcha invisible, activado en Supabase Auth > Attack Protection): el alta sin token falla, también si se llama a Supabase directo. El cliente resuelve el captcha por adelantado solo si no tiene sesión y lo envía en la cabecera `X-Captcha-Token`; la llave secreta vive únicamente en Supabase. Verificación opcional por teléfono (OTP) que aumenta el peso de los votos.
- Sesiones con refresh tokens rotativos. Cookies `HttpOnly`, `Secure`, `SameSite=Lax`.

### Base de datos — RLS obligatorio
- **RLS activado en TODAS las tablas sin excepción.** Una tabla sin políticas es un bug crítico.
- Políticas mínimas: cada usuario lee y escribe solo sus `profiles`, `user_places`, `push_subscriptions`. Nadie lee `reports` de otros usuarios. `sectors` es de lectura pública. **`incidents` NO es legible por clientes** (guarda la celda de origen, conteos y horas exactas): el cliente lee solo una vista o RPC `published_zones` con `{zona, res, tipo, proveedor, estado, cubo_publicado}`, y Realtime emite únicamente esa vista, en cubos de 5 min. Prueba pgTAP: anon y authenticated no pueden leer el origen ni `distinct_users`.
- Escrituras en `incidents` solo desde funciones del servidor.
- Las políticas RLS **tienen pruebas automáticas** (pgTAP) en CI: usuario A no puede leer ni modificar datos de usuario B.
- Funciones `security definer` con `search_path` fijo y revisión obligatoria.

### Aplicación
- Validación con Zod de todo input en el servidor (tipos, rangos, longitudes, enums).
- Headers de seguridad: CSP estricta (con nonce), HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (solo geolocalización y cámara cuando se usen), `frame-ancestors 'none'`.
- CSP con nonce implica HTML renderizado por petición (sin `cacheComponents` ni PPR: el shell estático no lleva nonce y el CSP bloquea todo el JS). Verificar siempre en un navegador real, no solo con build y tests. El HTML no se cachea en CDN; el rendimiento depende del Service Worker y de que los datos del mapa vengan de `/api/v1/map` cacheado.
- Fotos: límite 5 MB, solo JPEG/PNG/WebP, **eliminar metadatos EXIF** (incluyen GPS exacto), recomprimir en servidor, URLs firmadas con expiración. Moderación automática básica antes de publicar.
- Sin secretos en el repositorio. `.env*` en `.gitignore`. Escaneo de secretos en CI (gitleaks o GitHub secret scanning).
- Dependencias: Dependabot o Renovate, `npm audit` en CI, lockfile versionado. Revisar antes de agregar cualquier librería nueva.
- Protección contra OWASP Top 10: inyección (consultas parametrizadas), XSS (nunca `dangerouslySetInnerHTML` con datos de usuarios), CSRF, IDOR (RLS + verificación de propiedad), SSRF.
- Errores al cliente sin detalles internos (sin stack traces ni mensajes SQL).

---

## 10. Privacidad y cumplimiento legal

- Cumplir la **Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador**: consentimiento explícito para ubicación y notificaciones, finalidad declarada, minimización, derechos de acceso, rectificación y eliminación.
- Pantalla de consentimiento clara antes de pedir ubicación. La app funciona aunque el usuario niegue la ubicación (elige su sector manualmente).
- "Eliminar mi cuenta y mis datos" accesible en ajustes, efectivo en ≤30 días (idealmente inmediato).
- **Supresión de cuenta:** se eliminan los `reports`, `confirmations` y el `net_hash` del usuario; los contadores de incidentes ya publicados son enteros que no se recalculan, así que borrar una cuenta nunca oculta, retracta ni resuelve una zona (si no, la desaparición de una zona delataría a quien se borra). Los backups y PITR conservan el `net_hash` más de 7 días; la política de privacidad debe decirlo.
- **k-anonimato:** nunca mostrar un incidente con menos de 3 usuarios distintos, calculados como personas acumuladas en la zona mostrada y su disco (§7). Nunca mostrar quién reportó ni conteos menores a 3.
- Política de privacidad y términos de uso publicados antes del lanzamiento. Aviso: la información es comunitaria y no oficial.
- Datos vendidos o compartidos con terceros (fase 2 B2B): **solo agregados y anonimizados**, nunca datos individuales.
- Logs sin datos personales (sin teléfonos, sin tokens, sin coordenadas).

---

## 11. APIs

- REST versionada: `/api/v1/...`. Cambios incompatibles → `/api/v2`.
- Endpoints iniciales:
  - `GET  /api/v1/map?bbox=...&types=...` → estado agregado por celda (cacheable).
  - `POST /api/v1/reports` → crear reporte (requiere `client_request_id` para idempotencia).
  - `POST /api/v1/confirmations` → responder confirmación.
  - `GET  /api/v1/sectors/:id/history` → historial del sector.
  - `GET/POST/DELETE /api/v1/me/places`, `/api/v1/me/push`.
  - `DELETE /api/v1/me` → eliminar cuenta.
- Formato de error uniforme: `{ "error": { "code": "RATE_LIMITED", "message": "...", "requestId": "..." } }`.
- Códigos HTTP correctos (400, 401, 403, 404, 409, 422, 429, 500).
- Paginación por cursor, nunca por offset en tablas grandes.
- Esquemas Zod compartidos → documentación OpenAPI generada automáticamente.
- Cada request lleva un `requestId` que aparece en logs y en Sentry.

---

## 12. Rate limiting y antiabuso

Con `@upstash/ratelimit` (sliding window), por usuario **y** por IP:

| Endpoint | Límite |
|---|---|
| `POST /reports` | 10 por hora por usuario; máximo 1 por tipo y celda cada 10 min |
| `POST /confirmations` | 30 por hora |
| `GET /map` | 60 por minuto por IP (la mayoría se sirve desde caché) |
| OTP de teléfono | 3 por hora por número y por IP |
| Subida de fotos | 5 por hora |

- Respuesta `429` con header `Retry-After`.
- Valores aplicados en `POST /reports` (se afinan con k6): 120/h por IP (las redes móviles comparten IP), 10/h por usuario, 1 por tipo y celda cada 10 min y 60 altas de sesión anónima por hora por IP. Si Redis no responde, el endpoint cierra con 503 (falla cerrado).
- Detección de patrones de abuso: muchos usuarios nuevos reportando desde la misma red (`net_hash`, §6) → alerta, sin cambiar pesos (castigaría a usuarios reales con datos móviles compartidos). Con ≥5 cuentas nuevas de una misma red en 60 min se dispara la alerta; la defensa es la deduplicación por incidente (§7), y no se bloquea la red entera. El captcha (Turnstile) protege el alta de sesión anónima en Supabase.
- Cloudflare Turnstile está activo en el alta de sesión anónima (decisión del 26/10/2026).

---

## 13. Caché y rendimiento

### Caché
- `GET /map`: `Cache-Control: public, s-maxage=15, stale-while-revalidate=60` en CDN + caché en Redis por bbox/zoom. En un apagón masivo, miles de personas abren la app a la vez: **la BD nunca debe recibir esas lecturas directamente**.
- Sectores y geometrías: estáticos, caché larga con versionado por hash.
- Service Worker: app shell en caché (offline first); el mapa muestra el último estado conocido con la hora "actualizado hace X min" si no hay conexión. Reportes hechos sin conexión se guardan en cola local (IndexedDB) y se envían al reconectar.

### Frontend comprimido y liviano
- Compresión Brotli/gzip (automática en Vercel; verificar en headers de respuesta).
- **Sin source maps públicos en producción:** `productionBrowserSourceMaps: false` en `next.config`. Los source maps se suben **solo a Sentry** durante el build (de forma privada) y se eliminan del output desplegado. Verificar en CI que no exista ningún `.map` accesible públicamente.
- Minificación y tree shaking (por defecto en Next.js); eliminar `console.log` en producción.
- **Presupuesto de rendimiento** (CI falla si se excede):
  - JS inicial ≤ 150 KB comprimido.
  - LCP < 2,5 s en 4G lento; INP < 200 ms; CLS < 0,1.
  - Lighthouse móvil ≥ 90 en rendimiento, accesibilidad y buenas prácticas.
- Carga diferida (lazy) del mapa y componentes pesados. `next/image` con WebP/AVIF. Fuentes del sistema o una sola fuente con `font-display: swap`.

---

## 14. Escalabilidad

El patrón de tráfico es de **picos extremos**: tráfico bajo en días normales y explosión cuando hay un apagón grande o una inundación. Diseñar para el pico, no para el promedio.

- Objetivo de diseño: soportar **50.000 usuarios activos en 10 minutos** y 500 reportes por segundo en pico, sin degradar el mapa.
- Lecturas desde CDN/Redis; escrituras ligeras e idempotentes.
- Agregación de reportes → incidentes de forma asíncrona (trigger liviano + job), no en la request del usuario.
- Pool de conexiones (Supavisor, modo transaction) para funciones serverless.
- Realtime: un canal por zona con estado agregado, con *throttle* de emisiones (máximo 1 actualización cada 5 s por canal).
- Notificaciones masivas siempre por cola, nunca en bucle dentro de una request.
- **Pruebas de carga con k6** antes del lanzamiento y antes de cada temporada de lluvias, simulando un apagón masivo en Guayaquil.
- Plan de crecimiento: réplicas de lectura en Supabase y particionar `reports` por mes cuando supere ~10M filas.
- Modo degradado: si la BD está saturada, la app sigue mostrando el último mapa cacheado y encola los reportes.

---

## 15. Monitoreo y observabilidad

- **Sentry** en cliente y servidor: errores, rendimiento, releases vinculados a commits. Alertas por email/Slack/WhatsApp cuando aparece un error nuevo o sube la tasa de errores.
- **Uptime monitoring** cada 1 min de: home, `/api/v1/map`, `/api/health` (verifica BD y Redis). Alerta si cae.
- **Logs estructurados** (JSON) con `requestId`, sin datos personales.
- **Dashboards:** latencia p95 de la API, tasa de errores, reportes por minuto, incidentes activos, notificaciones enviadas/entregadas/respondidas, uso de Redis y conexiones a la BD.
- **Alertas de negocio:** pico anormal de reportes (posible ataque o evento real), cola de notificaciones atrasada > 2 min, tasa de confirmación muy baja.
- **SLO inicial:** 99,5% de disponibilidad mensual; p95 de `GET /map` < 300 ms.
- Página de estado pública simple.

---

## 16. Control de versiones y flujo de trabajo

- Git + GitHub. Rama `main` protegida: sin push directo, PR obligatorio, CI verde obligatorio.
- Ramas: `feat/...`, `fix/...`, `chore/...`. Commits con **Conventional Commits** (`feat:`, `fix:`, `refactor:`...).
- PRs pequeños y enfocados. Cada PR describe qué cambia, por qué y cómo probarlo.
- Entornos: **local** (Supabase CLI local) → **preview** (Vercel por PR + rama de Supabase) → **producción**.
- Migraciones de BD versionadas en el repo, aplicadas por CI. Toda migración debe ser reversible o tener plan de rollback.
- Tags semánticos (`v0.1.0`) en cada release a producción. Changelog generado de los commits.
- **CI (GitHub Actions) en cada PR:** lint (ESLint) → typecheck (`tsc --noEmit`) → tests unitarios → pruebas de RLS (pgTAP) → build → verificación de presupuesto de bundle → verificación de que no haya `.map` públicos → `npm audit` → escaneo de secretos → e2e (Playwright) en el preview.

---

## 17. Backups y recuperación

- Backups diarios automáticos de Supabase + PITR (point-in-time recovery) al pasar a plan pago.
- Probar una restauración real al menos una vez antes del lanzamiento.
- Runbook en `/docs/runbooks/` para: BD caída, Redis caído, pico de abuso, filtración de credenciales (rotación de keys).

---

## 18. Accesibilidad y UX

- WCAG 2.1 AA: contraste, tamaños táctiles ≥ 44 px, etiquetas para lectores de pantalla.
- **No depender solo del color** en el mapa: usar íconos y patrones (relevante para daltonismo). Sistema de color del mapa (decisión del 26/10/2026): el **tipo** va en ícono y patrón (rayo, gota, señal, ola); el **estado** va en color. Cortes: amarillo (hasta 2 h), naranja (2 a 4 h), rojo (más de 4 h); volvió: verde; sin reportes: gris; zona que el usuario sigue: solo contorno, sin relleno. **Inundación: siempre azul** (propio, distinto del azul marino de marca), con el nivel en gotas y texto, y contorno rojo solo en "no pasa carro". Nunca se muestra el número exacto de reportes: se muestran niveles. Siempre se acompaña de texto del tiempo ("hace 3 h"), calculado desde el instante publicado (cubo de 5 min de la confirmación) y redondeado, nunca desde el primer reporte.
- Modo oscuro (ahorra batería durante apagones en pantallas OLED).
- Textos de la UI centralizados en archivos de i18n desde el inicio (aunque solo exista español).

---

## 19. Cómo debe trabajar Claude Code en este repo

1. Antes de implementar algo no trivial, propone un plan corto y espera confirmación.
2. Trabaja en ramas y PRs pequeños; nunca hagas push directo a `main`.
3. Toda tabla nueva lleva RLS + políticas + pruebas pgTAP en el mismo PR.
4. Todo endpoint nuevo lleva validación Zod, rate limit, manejo de errores uniforme y test.
5. Nunca expongas secretos ni la `service_role key` en el cliente. Nunca hagas commit de `.env`.
6. Pregunta antes de: borrar datos, cambiar el esquema de producción, agregar dependencias pesadas (>30 KB), o cambiar umbrales de §7.
7. Prioriza el peso del bundle y el rendimiento en Android gama baja en cada decisión de UI.
8. Si algo de este documento está desactualizado o es incorrecto, dilo y propone la corrección.
9. Al terminar una tarea: ejecuta lint, typecheck y tests; resume qué cambió y qué falta.

### Subagentes (`.claude/agents/`)

El agente principal construye. Los subagentes son especialistas que revisan, prueban y cuidan áreas críticas. **No** uses subagentes para escribir en paralelo partes distintas de la app.

| Subagente | Cuándo invocarlo |
|---|---|
| `db-supabase` | Cualquier cambio en tablas, migraciones, RLS, índices, funciones SQL o pruebas pgTAP. |
| `incident-logic` | Cualquier cambio en §7 (reportes → incidentes, confirmaciones, trust score, expiraciones, antiabuso). |
| `copy-es` | Textos visibles al usuario: pantallas, notificaciones, errores, consentimiento. |
| `test-runner` | Después de cada cambio de código y antes de cada PR. |
| `security-reviewer` | Antes de **cada** PR. Obligatorio si se tocó BD, auth, endpoints, fotos, env o logs. |
| `perf-auditor` | Antes de cada PR que toque UI, dependencias, `next.config`, lecturas o realtime, y antes de cada release. |
| `revisor-opus` | Validador final (modelo Opus). Al cerrar cada semana, antes de aprobar el plan de la siguiente, antes de cada release y ante decisiones de arquitectura difíciles. Solo lectura. |

**Regla de cierre de PR:** antes de abrir cualquier PR, invoca `test-runner` y `security-reviewer`. Si alguno responde FALLA o BLOQUEADO, corrige y vuelve a invocarlo. No abras el PR hasta que ambos estén en verde. Incluye en la descripción del PR el resumen de sus reportes.

**Regla de cierre de semana:** antes de dar por cerrada una semana del plan (§20) y antes de empezar la siguiente, invoca `revisor-opus` con los resultados y el plan propuesto. Si responde NO APROBADO, corrige antes de avanzar. Sus hallazgos CRÍTICOS y sus decisiones para el usuario se presentan al usuario antes de pedirle que apruebe el plan.

---

## 20. Plan de entrega (prioridad por El Niño)

**Semana 1 — Base**
- Repo, CI, entornos y deploy mínimo a Vercel desde el Día 1; Sentry (sin datos personales: sin IP, cuerpos ni coordenadas), uptime.
- Esquema inicial con RLS y pruebas pgTAP solo para las tablas que se usan: `profiles`, `sectors`, `reports`, `config`. El resto llega en Semana 2 con su lógica.
- Auth anónima con captcha de Supabase activado desde el inicio (limita la creación masiva de identidades).
- Mapa con celdas H3 res 8 sobre Guayaquil; los nombres de sector salen de OpenStreetMap después. Teselas PMTiles autoalojadas (Protomaps). MapLibre se carga diferido y su peso se mide aparte del presupuesto de JS inicial.
- Reporte manual de luz/agua/inundación: solo se guarda; la agregación a incidentes es Semana 2.
- Cada paso de CI se agrega cuando verifica algo real (sin pasos de relleno).

**Semana 2 — Núcleo**
- Lógica de incidentes (§7), push y flujo de confirmación, suscripción a sectores.
- Capa de inundación con foto (EXIF eliminado, moderación).
- Rate limiting y caché del mapa.

**Semana 3 — Lanzamiento**
- Internet por proveedor, historial por sector, PWA instalable y modo offline.
- Prueba de carga k6, política de privacidad y términos, checklist de lanzamiento (§21).
- Lanzamiento suave en 3–5 ciudadelas de Guayaquil. El mapa público se enciende por celda res 7 (la "ciudadela" no existe en el modelo H3) cuando se alcance una adopción local mínima (referencia: 1 % de la población de esa zona, según INEC), contando cada cuenta una sola vez, con más de 7 días y con push activo; por eso la primera semana del piloto no publica mapa y muestra "estamos juntando avisos". Es un control de seguridad contra oleadas de cuentas falsas, no solo de producto. La densidad de usuarios pesa más que cualquier regla (simulación del 26/10/2026).

**Después:** app Android nativa con detección automática, cronogramas oficiales, expansión a Quito, Durán, Daule, Samborondón y Manabí.

---

## 21. Checklist antes de producción

- [ ] RLS activo en todas las tablas y pruebas pgTAP pasando
- [ ] Ningún secreto en el cliente ni en el repo (escaneo limpio)
- [ ] Sin source maps públicos; source maps subidos a Sentry
- [ ] Headers de seguridad verificados (securityheaders.com con nota A)
- [ ] Rate limiting activo en todos los endpoints de escritura
- [ ] Mapa servido desde caché; prueba de carga k6 superada
- [ ] Sentry, uptime y alertas funcionando (probar con un error forzado)
- [ ] Backups activos y una restauración probada
- [ ] Política de privacidad, términos y aviso "no oficial / ECU 911" publicados
- [ ] Eliminación de cuenta funcionando
- [ ] Lighthouse móvil ≥ 90; JS inicial ≤ 150 KB
- [ ] Probado en Android gama baja real y en iPhone con PWA instalada
- [ ] Dominio propio con HTTPS y redirección www/no-www configurada
