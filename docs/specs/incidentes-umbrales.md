# Umbrales de incidentes con celdas vecinas, ventana de 60 min y agrupación a res 7

Versión: v3 (26/10/2026). Estado: diseño aprobado con decisiones abiertas, NO implementado. Las decisiones de producto
aprobadas el 26/10/2026 (noche, retracción, OTP después del lanzamiento, expiración a 60 min) son reglas normales (§2, §3, §5);
los endurecimientos de seguridad de la revisión posterior están marcados en §12. Quedan abiertos los puntos de §11 y los
REQUISITOS PREVIOS A IMPLEMENTAR de §13. `CLAUDE.md` debe alinearse con esta spec (ver §10). Base: CLAUDE.md §7, §8, §10, §12, §14.
Simulación que respalda las cifras: `scripts/sim/umbrales.mjs` (comando de reproducción y tiempos en §8). Los resultados contradicen en parte conclusiones anteriores: ver §8.8.

Fijo e inamovible (no es configurable): k = 3 personas distintas, proporción sí/(sí+no) >= 0,6,
"sospechado" es interno y nunca se muestra, el peso del voto depende de `trust_score`.

Medidas aprobadas: (1) contar en celda + vecinas (`gridDisk` k=1, 7 celdas), (2) mostrar a la resolución más fina
con k>=3 (res 8, si no res 7), (3) votos válidos 60 min, (4) lanzamiento concentrado en 3 a 5 ciudadelas, con un
mínimo de adopción local de ~1 % (§2, regla 7).

Protecciones aprobadas (salen de la simulación; sin ellas la medida 1 abre un hueco de abuso y empeora los cortes
pequeños, §8): (a) ancla en la celda, (b) espera mínima de 5 min, (c) "no" de vecinas con peso 0,5, (d) la
pregunta va primero a la celda propia, con relleno obligatorio (APROBADO 26/10/2026; ver §2.6 y §8.8).
Además, defensa por red (§6.3), mínimo de adopción local (§2, regla 7), regla de noche (§2, regla 8), retracción (§2, regla 9)
y tope duro de visibilidad (§2, regla 10).

---

## 1. Máquina de estados

```
(sin incidente) --[>=2 personas reportan en celda+vecinas en 15 min]--> suspected (interno, celda de origen c FIJA)
suspected --[>=3 personas con "sí", ratio ponderado >= 0,6, ancla, espera >= 5 min, votos de los últimos 60 min,
             y de noche: >=5 personas Y >=2 anclas]--> confirmed   (se PUBLICA en el siguiente cubo de 5 min)
suspected --[expire_suspected_minutes = 60 sin confirmar]--> expired
confirmed --[resolución: >=3 personas (dedup por red, cuentas >24 h) dicen "ya volvió"/back y proporción >=0,6; un solo back NUNCA cierra]--> resolved
confirmed --[retracción: >=3 personas (cuenta y lugar >24 h, dedup por red, ponderadas por trust) de la celda propia dicen "no" y la proporción baja de 0,4]--> expired (se oculta)
confirmed --[publicado de noche y a las 06:30 sin "sí" de >=2 personas que no participaron]--> expired (revisión de la mañana)
confirmed --[sin renovación (>=2 personas, redes distintas, "sí" nuevo de cuentas >24 h) durante 12 h, o techo absoluto de 48 h (luz y agua) sin reconfirmar]--> expired (tope)
Borrar cuentas NUNCA mueve estas transiciones (los contadores se materializan, §4.4).
```

Realtime: canal Broadcast alimentado por el job de §7.1, nunca `postgres_changes` sobre `incidents` (y Realtime tampoco funciona sobre vistas).

Cambia QUÉ se cuenta (celda + vecinas), CUÁNTO duran los votos (60 min), A QUÉ resolución se muestra, CUÁNDO se
puede publicar (noche) y CÓMO se corrige un error (retracción).

### 1.1 Identidad del incidente
- La celda de origen `c` se FIJA al crear el incidente y no se mueve aunque lleguen más reportes en otras celdas.
- Índice único parcial: `(type, coalesce(provider,''), origin_cell) where state in ('suspected','confirmed')`. Evita
  duplicados aunque el job se ejecute dos veces o dos reportes lleguen a la vez.
- Un reporte que cae en los discos de dos incidentes activos (mismo tipo y proveedor) va al incidente de origen más
  cercano (`gridDistance`); empate = menor id de incidente.
- Un reporte nuevo en `D(c)` de un incidente activo lo alimenta; si no hay incidente activo se evalúa el
  umbral de sospechado y, si se cumple, se crea uno con `c` = celda con más reportes (empate = menor id H3).

## 2. Reglas exactas del conteo con vecinas

Definiciones:
- **Disco de la celda c**: `D(c) = gridDisk(c, config.incident_neighbor_k)` (7 celdas con k=1).
- **Persona**: un usuario distinto (`user_id`), con peso de voto > 0 y que no esté excluido por antigüedad (§2.5).
  Usuarios con shadow limit (peso 0) no cuentan como persona ni en el sí ni en el no. Una persona cuenta UNA vez por
  incidente aunque tenga lugares suscritos en varias celdas del disco, haya reportado y además respondido, o haya
  cambiado su respuesta (cuenta la ÚLTIMA respuesta de cada persona).
- **Persona por red** (defensa de §6.3): las cuentas que comparten `net_hash` dentro del mismo incidente cuentan como
  UNA persona (con el mayor de sus pesos). Si el grupo de una red tiene votos mixtos, gana el "no". La exención por
  teléfono verificado está DESACTIVADA: el OTP queda para después del lanzamiento (decisión aprobada 26/10/2026) y la
  exención se revisará entonces.
- **`person_key`** (tabla de votos): un identificador ALEATORIO por incidente (se genera al primer voto de la persona o del grupo de red en ese
  incidente), NO derivado del `net_hash` ni del `user_id` (§7.1, §4.4). La agrupación por red se resuelve con el `net_hash` mientras exista (7 días),
  pero el `net_hash` no se copia a la tabla de votos.
- **Ancla**: persona con "sí" cuya celda es `c`, con cuenta de más de 24 h. La celda de la persona es su lugar
  suscrito con más de `user_places_min_age_h` (24 h) de antigüedad, o la celda del reporte que hizo. Quien reporta
  sin estar suscrito sí tiene celda (la del reporte), pero cuenta como ancla solo si su cuenta tiene más de 24 h.

Reglas:
1. **Sospechado** (sin cambios): >=2 personas distintas reportan el mismo tipo (e igual proveedor si es internet) en
   `D(c)` dentro de `incident_suspect_window_min` (15). Es interno y nunca se muestra.
2. **Quién recibe la pregunta** (APROBADO 26/10/2026; detalle y reglas obligatorias en §2.6): hasta `incident_ask_max` (40) por incidente, PRIMERO a los
   suscritos de la propia celda `c` (`incident_ask_own_cell_first` = true), completando con el resto de `U(c)` (res 7), con relleno OBLIGATORIO de suscritos de celdas
   sin reportes (`incident_ask_filler_pct` bloqueada, mínimo > 0, falla cerrado), texto neutro, retraso aleatorio de 0 a 2 min, máximo 1 destinatario por `net_hash`
   por incidente y exclusión de cuentas de menos de 24 h. Costo aceptado de privacidad en §2.6 y §9 (riesgo 9).
3. **Confirmado** (nivel res 8): sobre los votos de los últimos `incident_vote_window_min` (60) de personas con lugar
   suscrito en `D(c)` (o con el reporte en `D(c)`):
   - personas con "sí" (el reporte original cuenta como "sí") >= 3, y
   - `suma_pesos_sí / (suma_pesos_sí + suma_pesos_no) >= 0,6`, y
   - ancla: al menos 1 "sí" de una persona ancla (`incident_anchor_required`), y
   - no antes de `incident_confirm_min_wait_min` (5) minutos tras pasar a sospechado, y
   - de noche (regla 8): además >=5 personas Y >=2 anclas (`night_publish_mode = and`), y
   - el "no" de una persona cuya celda no es `c` pesa `incident_ring_no_weight` (0,5), porque vecinos sin corte no
     desmienten un corte de una sola celda; el "no" de cuentas de menos de 24 h pesa 0,5 hasta tener peso por
     antigüedad (§2.5). Los dos factores no se multiplican: se aplica el menor.
   "No estoy en casa" no suma ni resta.
4. **Cobertura sin exclusividad por origen**: se muestra TODA celda que cumpla su ancla y tenga k>=3 en su disco. No
   se limita a una zona por incidente: de lo contrario un apagón de 37 celdas se vería como lunares aislados. El
   incidente (identidad, §1.1) es único por origen; las celdas mostradas son las que cumplen la regla 3 con su propia
   ancla, calculadas desde los votos del mismo incidente. Medido en v2 (§8.2): la cobertura sube a 98-100 % de las celdas
   con corte, pero la agrupación a res 7 pinta también celdas SIN corte (unas 11 en un corte de 7 celdas con adopción 1 %).
5. **Persistencia**: el estado `confirmed` no se revierte cuando los votos salen de la ventana de 60 min. La ventana
   solo decide la entrada a `confirmed`. Para mostrar se usa `distinct_users` ACUMULADO del incidente (nunca baja).
   Las únicas salidas de `confirmed` son resolución (regla 11), retracción (regla 9), tope de visibilidad (regla 10) y revisión de la mañana (regla 8).
6. **Frontera de celdas**: el disco ya cubre a quien reporta pegado al borde (su vecino está dentro del conteo).
   Para res 7, los hijos de un padre res 7 no coinciden exactamente con la cuadrícula res 8 (H3 no es anidado
   perfecto), así que el universo de conteo para promover es `U(c) = D(c) ∪ hijos_res8(padre_res7(c))`.
   Un reporte nunca se asigna por distancia al borde: la celda la fija el cliente (H3 res 8) y el servidor no la
   reinterpreta.
7. **Mínimo de adopción local** (control de seguridad, no solo de producto): una zona (celda res 7) solo puede
   publicar incidentes si la adopción local supera ~1 % (`adoption_min_pct`). Unidad = celda res 7 (en el modelo de
   datos no existe "ciudadela"); población de referencia = INEC (habitantes por celda res 7, tabla estática). Cómo se cuenta (endurecido):
   - cada cuenta cuenta UNA vez, en su lugar suscrito más antiguo (no en varios);
   - solo cuentan cuentas con push activo (`last_success_at` de `push_subscriptions` <= 30 días) y cuenta de más de 7 días;
   - ya NO existe la vía "o al menos un voto coincidente con un incidente confirmado" (era circular: un incidente falso confirmado habría
     contado como adopción);
   - alerta y CONGELAMIENTO de la compuerta si el conteo de una celda res 7 crece más de `adoption_surge_factor` veces su mediana en un día:
     mientras esté congelada se usa el conteo previo al salto y se avisa al operador.
   Por debajo del mínimo no se publica nada en esa celda res 7 (los reportes se guardan). Medido (§8.4): con adopción de 0,1 % o
   0,5 % y sin esta compuerta, 30 cuentas falsas fabrican de 4,9 a 11,9 zonas; con la compuerta, 0. Honestidad sobre su fuerza: para
   superarla con adopción 0,1 % el atacante necesita unas 315 cuentas de más de 7 días con push activo. Es un FRENO DE OLEADAS, no una defensa
   fuerte: un atacante con presupuesto y paciencia las consigue. Costo medido: con adopción 0,5 % un corte de 7 celdas deja de verse (99 % -> 0 %).
   Consecuencia: internet por proveedor reparte la adopción entre 5 proveedores, por lo que casi no confirmará en el piloto (§8.6); se acepta y se mide.
   Arranque: como solo cuentan cuentas de más de 7 días, durante la primera semana tras el lanzamiento ninguna zona
   alcanza el mínimo y NO se publica mapa (aceptado; se alinea en CLAUDE.md, §10).
8. **Horario silencioso (22:00 a 06:00, hora de Ecuador)** — APROBADO 26/10/2026; modo de publicación endurecido:
   - No se envían preguntas push entre las 22:00 y las 06:00 (`night_quiet_start`/`night_quiet_end`, configurables).
     Excepciones: se permite preguntar luz y agua hasta las 23:00 (`night_ask_until_power_water`; internet e inundación NO), y la inundación
     severa en su sector sigue la excepción de CLAUDE.md §8.
   - Para publicar (confirmar) dentro de ese horario se exigen, además de todo lo de la regla 3, >=5 personas (`night_publish_min_persons`)
     Y >=2 anclas (`night_publish_min_anchors`): `night_publish_mode` = `and` (valor inicial; `or` queda disponible pero NO es el valor inicial).
   - Por qué `and` y no "no publicar de noche cortes de 1 celda": el modo `or` no frenaba nada (medido 100 % de zonas falsas con 3 cuentas de
     más de 24 h a las 02:00, porque son 3 anclas; §8.3). `and` frena a 3 cuentas (0 %) y cuesta ver cortes reales pequeños de noche (1 celda, 1 %:
     de 30 % a ~0-6 %; con 7 celdas o más casi no cambia, 92-100 %). Se prefiere `and` a prohibir 1 celda de noche porque no descarta un corte real
     de 1 celda cuando hay mucha gente despierta y reportando. NO frena a un atacante de 5 cuentas (§8.3): ese caso lo cubre la revisión de las 06:30.
   - Las rondas de "¿Ya volvió?" y de retracción también se SUSPENDEN de noche (son preguntas push). Por tanto la primera ronda de lo publicado de noche
     se programa a las 06:00 EXACTAS (sin esperar los 30 min de `retract_first_ask_min`).
   - Revisión de la mañana: todo incidente publicado entre 22:00 y 06:00 expira automáticamente si a las `night_review_deadline` = 06:30 no hay un "sí"
     de >=2 personas (dedup por red, cuentas >24 h) que NO participaron en el incidente antes de las 06:00 (ni como reporte ni como voto).
   - La hora que cuenta es la del instante de confirmación. Lo confirmado de noche sigue las mismas reglas de resolución y retracción.
   - Reconocimiento: la regla anterior "5 personas o 2 anclas" no frenaba nada (medido 100 %).
9. **Retracción tras confirmar** — APROBADA 26/10/2026 (valores N=3 y 0,4 PENDIENTES de simulación adversaria, §13.1; endurecida):
   - Después de confirmar se pregunta "¿Ya volvió?" no solo a quienes confirmaron sino también a suscritos del disco que
     NO votaron: primera ronda a los `retract_first_ask_min` = 30 min y luego cada `retract_ask_every_min` = 60 min, hasta
     `incident_ask_max` (40) por ronda (de noche: regla 8). Las respuestas "no tuve corte / ya tengo servicio" cuentan como "no" del incidente.
   - Quién cuenta para el N de retracción (endurecido): solo personas con cuenta de más de 24 h Y lugar suscrito de más de 24 h en la celda
     propia, deduplicadas por red (§2) y ponderadas por `trust_score`. Cuentas nuevas o con lugar reciente no retractan.
   - Se retracta (el incidente pasa a `expired` y la zona se oculta en el siguiente cubo de 5 min) cuando se cumplen las DOS cosas:
     (a) `retract_min_no_persons` = 3 personas que cumplen lo anterior dicen "no", y
     (b) la proporción sí/(sí+no) baja de `retract_ratio` = 0,4, calculada sobre todos los votos acumulados del incidente
     (con el "no" de otras celdas a peso 0,5) Y TAMBIÉN calculada solo con las personas de la celda propia (`retract_ratio_basis` = `both`).
   - Por qué 3 y 0,4 (provisional): 3 es el mismo número que hace falta para publicar (k = 3); 0,4 es el complemento de 0,6 y deja una zona gris
     (0,4 a 0,6) para que un corte parcial no parpadee. Con las dos proporciones, medido: corte real al 60 % de la celda se retractaba por error
     25 % a 62 % con una sola, 0 a 5 % con ambas (§8.7). OJO: esa medición NO incluye a un atacante que retracta un corte real (§9, riesgo 17).
   - Derecho de supresión (§4.4) y no filtrar por desaparición: la retracción la decide un conjunto de personas, nunca una
     sola; los contadores de retracción se materializan y borrar una cuenta no retracta ni oculta nada.
   - Cooldown (`retract_cooldown_h` = 6 h, valor sin medir) tras retractar: NO bloquea votos nuevos. Durante el cooldown se puede republicar con la
     regla normal (regla 3 completa, incluida la de noche) usando SOLO "sí" posteriores a la retracción y de personas que NO votaron en el incidente
     retractado. Así el atacante no puede enterrar con "no" un corte real y bloquearlo 6 h, y tampoco reciclar los mismos votos falsos.
10. **Tope de visibilidad** — APROBADO 26/10/2026; renovación endurecida: un incidente `confirmed` se renueva (reinicia `incident_idle_cap_h` = 12 h)
    SOLO con >=`incident_renew_min_persons` = 2 personas distintas (dedup por red) con un "sí" NUEVO de cuentas de más de 24 h. Pasadas 12 h sin
    renovación se vuelve a preguntar a quienes confirmaron y a suscritos del disco; si no hay renovación, pasa a `expired`. Los votos de cuentas nuevas
    o de peso 0 no renuevan, y un solo "sí" (una cuenta o una red) tampoco. Además hay un TECHO ABSOLUTO (`incident_abs_cap_h` = 48 h para luz y agua)
    desde la publicación (o desde la última reconfirmación completa): pasado el techo se exige de nuevo la regla de confirmación completa (regla 3, con
    votos nuevos) o pasa a `expired`. "Todavía sin luz" en una ronda de "¿Ya volvió?" renueva la visibilidad si lo dicen >=2 personas que cumplen lo anterior.
    Inundación conserva su regla propia (expira a 6 h sin renovación, CLAUDE.md §7); techo de agua/internet distinto de 48 h: por definir (§11).
11. **Resolución** (simétrica a confirmar; endurecida): un incidente pasa a `resolved` SOLO cuando >=`resolve_min_persons` = 3 personas distintas
    (dedup por red; cuentas de más de 24 h) responden "ya volvió" o envían un reporte `back`, y la proporción volvió/(volvió + "todavía sin luz")
    ponderada >= `resolve_ratio` = 0,6. "Todavía sin luz" cuenta como "no" a la resolución y renueva la visibilidad (regla 10). Un solo reporte
    `back` NUNCA cierra un incidente. Mismas reglas de ventana (60 min), "no estoy en casa" no cuenta, y contadores materializados (§4.4).
    Esto sustituye al "≥50 % o llegan reportes back" de CLAUDE.md §7 (alinear, §10).

### 2.5 Antigüedad de cuentas y de lugares suscritos (`user_places`)
- Un lugar nuevo o cambiado NO cuenta como ancla ni como voto hasta pasadas `user_places_min_age_h` = 24 h.
- Cooldown de `user_places_change_cooldown_h` = 24 h entre cambios del mismo lugar y límite de
  `user_places_changes_per_day` cambios por día por usuario. Evita "mudarse" a la celda objetivo para votar.
- Las cuentas con menos de 24 h quedan fuera del conteo k y del muestreo de preguntas (§2.6); su "no" pesa 0,5.
  Medido en v2 (§8.4): cuentas nuevas acaparando preguntas ocupan 0 de 40; cuentas con más de 24 h ocupan 5 de 40 con 200 cuentas y 16 de 40 con 1.000.
- El umbral de cuentas de más de 24 h es un FRENO DE OLEADAS, no una defensa contra atacantes pacientes (quien espera 24 h cuenta, peor caso medido).
  Efecto colateral: los usuarios que se instalan durante el apagón no cuentan en k, anclas, retracción ni resolución el primer día (en el pico más
  valioso, la mayoría de las altas son nuevas, §8.5).
- El peso por antigüedad crece con el tiempo y el trust; la curva queda por definir con datos del piloto.

### 2.6 La pregunta push no filtra información
Un ataque de inferencia: si solo reciben la pregunta los suscritos de la celda con reportes, recibirla prueba que
hay reportes (o un sospechado) cerca. Por eso:
1. REPARTO APROBADO 26/10/2026: la pregunta se envía PRIMERO a los suscritos de la propia celda `c`, completando hasta `incident_ask_max` con el resto de
   `U(c)` (res 7) en muestra aleatoria, y siempre con el relleno obligatorio del punto 4. Resultado medido que lo justifica (§8.8, punto 1): visibilidad de cortes de
   1 celda 29 % -> 46 %; 3 cuentas falsas de más de 24 h publican 54 % -> 16 %. Costo aceptado: es de privacidad; quien recibe la pregunta puede inferir que hay
   reportes cerca. Se mitiga con el relleno obligatorio (punto 4) y el texto neutro (punto 2); se mide en el piloto (§9, riesgo 9).
2. Texto neutro que no nombra celda ni sector: "¿Tienes luz ahora en tu casa?" (equivalente para agua, internet con
   proveedor, inundación). Los textos finales los revisa `copy-es`. Esto reemplaza al ejemplo con sector de CLAUDE.md §8
   para esta pregunta de confirmación (alinear en CLAUDE.md cuando se apruebe el texto).
3. Retraso aleatorio de 0 a 2 min por destinatario antes de enviar.
4. Fracción de relleno OBLIGATORIO (`incident_ask_filler_pct`: clave BLOQUEADA, mínimo > 0; si vale 0 o falta, el sistema falla cerrado y no
   envía preguntas; el valor exacto se fija con el piloto, §11) de suscritos de celdas SIN reportes,
   que reciben la misma pregunta; así recibirla no prueba que haya reportes cerca. Sus respuestas no cuentan en k de
   ese incidente, salvo que su lugar caiga en `D(c)`.
5. Se excluyen del muestreo y del conteo de k las cuentas con menos de 24 h o con trust bajo: evita que un atacante
   acapare las 40 preguntas con cuentas propias y evita espiar a un único usuario real (si solo él recibiera la
   pregunta, su respuesta delataría su estado).
6. La protección (d) "preguntar primero a la celda propia" es regla aprobada (punto 1), ya no solo orden interno. El relleno nunca puede ser 0 y la pregunta
   no revela si el incidente está "sospechado".
7. Muestreo con máximo 1 destinatario por `net_hash` por incidente (regla de §2.6, antes propuesta de §11.3); las cuentas con `net_hash` NULL
   comparten un cupo máximo (`incident_ask_null_net_max`). Impide acaparar las 40 preguntas desde pocas redes.
8. Siguen los límites de CLAUDE.md §8: máx. 3 preguntas por usuario por día y 1 por incidente. Las preguntas de
   relleno consumen el mismo cupo diario. La pregunta "¿Ya volvió?" de la retracción (regla 9) es de otro tipo y no
   cuenta como pregunta de confirmación, pero sí consume el cupo de 3 al día (confirmar con producto, §11). De noche no se envía (regla 8).

## 3. Ventana de 60 min para los votos

- La ventana de reportes para pasar a sospechado sigue en 15 min. Los votos de confirmación valen 60 min
  (`incident_vote_window_min`).
- Un voto "sí" y un voto "no" caducan igual. Un usuario que cambia de respuesta reemplaza la anterior (cuenta la última).
- Efecto medido: alargar la ventana no ayudó por sí solo en cortes de 1 celda (más "no" de vecinas
  acumulados); ayuda poco en cortes de 7+ celdas porque ya confirman rápido (§8). Su valor real es con adopción
  baja y respuestas lentas.
- Interacción con notificaciones (§8 CLAUDE.md): las preguntas siguen siendo máx. 3/día y 1 por incidente;
  la ventana larga no autoriza preguntar más.

### 3.1 Expiración del sospechado a 60 min — APROBADO 26/10/2026
Antes había un conflicto: CLAUDE.md §7 expiraba el sospechado a los 45 min, pero los votos valen 60 min (un "sí" en el minuto 50
llegaba a un incidente ya expirado). Decisión: `expire_suspected_minutes` = 60, alineado con la ventana de votos. Es un cambio
de umbral de §7 y debe reflejarse en CLAUDE.md (§10 de esta spec).
Efecto medido en v2 (§8.7): prácticamente nulo con los supuestos del caso central (45 y 60 min dan lo mismo en todas las celdas) y de
0 a 1 punto con respuestas lentas (media de 25 min). Se mantiene 60 por coherencia, no porque se haya medido una mejora apreciable.

## 4. Mostrar a res 8 o res 7, sin delatar a nadie

### 4.1 Regla de resolución (histéresis simplificada)
Como el conteo acumulado nunca baja, no hay oscilación y no hace falta histéresis compleja:
- Una zona se publica en **res 8** si hay >=3 personas acumuladas en el disco `D(c)`; si no, en **res 7** (si hay >=3
  en `U(c)`). Si ninguna cumple, no se muestra (el incidente sigue confirmed internamente).
- Una zona publicada en res 7 solo puede **refinarse a res 8** (nunca al revés) al alcanzar >=5 personas acumuladas
  en el disco y pasados 10 min (`display_refine_min_persons` = 5, `display_refine_hold_min` = 10).
- Nunca se baja de res 8 a res 7 ni de mostrado a oculto por falta de votos recientes; un incidente mostrado solo
  termina por resolución, expiración, retracción (§2 regla 9) o tope duro (§2 regla 10).
- El k se cumple sobre el DISCO, no sobre la celda: "al menos 3 personas en un radio de ~2 km". Así se declara en la
  política de privacidad.

### 4.2 Qué ve el cliente: `published_zones`
- La tabla `incidents` NO es legible por clientes: sin política SELECT para `anon` ni `authenticated`.
- El cliente lee solo una vista o RPC `published_zones` con `{zone_h3, res, type, provider, state, published_bucket}`.
  El origen (`origin_cell`), los conteos (`distinct_users`, `report_count`), `confidence` y las marcas de tiempo
  exactas viven en una tabla privada (la propia `incidents` sin acceso de clientes, o `incidents_private`).
- Realtime = canal Broadcast alimentado por el job de §7.1 con el contenido de `published_zones`. NUNCA `postgres_changes` sobre `incidents`
  (filtraría filas privadas) ni sobre una vista (Realtime no funciona sobre vistas). Emite solo zonas publicadas, nunca filas de `incidents`, y solo en el cubo de `display_publish_bucket_s`
  (300 s). El throttle de 5 s por canal de CLAUDE.md §14 no sustituye al cubo: el cubo es el control de privacidad,
  el throttle es de carga. Una retracción se publica en el mismo cubo (la zona desaparece en el siguiente cubo de 5 min).
- El texto "hace 3 h" y el color por duración se calculan desde el instante publicado (el cubo de 5 min de la
  confirmación), redondeado, nunca desde `started_at` ni desde el primer reporte.
- Test pgTAP: `anon` y `authenticated` no pueden leer `h3_cell`/`origin_cell` de origen ni `distinct_users`
  (ni por select directo, ni por Realtime, ni por la RPC).

### 4.3 Cómo se evita que el tamaño de la zona delate a una persona
1. Solo existen dos tamaños (res 8 o res 7 completa). La zona es SIEMPRE una celda H3 fija; nunca un polígono
   construido con las celdas donde hay reportes ni con un tamaño proporcional al número de personas.
2. La condición de k usa el disco (7 celdas), así que la celda mostrada no revela en cuál de ellas está cada
   persona. En res 7, cualquiera de ~35.000 habitantes (7 celdas x 5.000) puede ser el votante.
3. El refinamiento de res 7 a res 8 exige >=5 personas (no 3) y 10 min de espera, lo que impide inferir "la persona X
   acaba de votar" mirando cuándo cambia la forma (ataque diferencial).
4. Cambios publicados en cubos de 5 min, sin conteos, sin hora exacta del primer reporte y nunca las celdas con
   votantes. Dentro de una zona res 7 mostrada no se dibuja una res 8.
5. Nunca se muestran conteos menores a 3. Alinear con CLAUDE.md §10: la API del mapa devuelve solo
   `{zona, tipo, estado}` y un nivel cualitativo **pocos / varios / muchos** (umbrales a definir con el piloto, §11), nunca el
   número exacto.
6. Inundaciones: los reportes se guardan en res 10 (calle) pero entran a la agregación y al disco siempre en su
   celda padre res 8. Nunca se publica una zona res 10.

### 4.4 Derecho de supresión
Regla: los contadores y proporciones de confirmación, retracción, resolución y renovación se MATERIALIZAN en el incidente (columnas privadas) al
procesar cada voto y NO se recalculan al borrar cuentas. Borrar una cuenta nunca confirma, retracta, resuelve, renueva ni oculta nada (si lo hiciera, la
desaparición de una zona delataría a quien se borra, y un atacante podría mover resultados borrando cuentas).
Al eliminar una cuenta se eliminan sus `reports` y sus `confirmations` (los votos y reportes del usuario desaparecen de esas tablas), su fila de
`anon_signups` y su `net_hash`; en la tabla de votos el `person_key` es aleatorio por incidente y no permite reidentificar (§2, §7.1). El efecto de
sus votos ya sumado en los contadores materializados permanece (es agregado, no dato personal). `distinct_users` acumulado es un entero que no se
recalcula. NINGÚN incidente ya publicado se oculta ni cambia por ello. Esto va a la política de privacidad. La retracción (§2 regla 9) es el único
mecanismo que oculta una zona por votos, exige >=3 personas y no se dispara por borrar cuentas.

## 5. Claves de `config`

| Clave | Valor | Descripción |
|---|---|---|
| `incident_suspect_window_min` | 15 | Ventana de reportes para sospechado (sin cambio). |
| `incident_suspect_min_persons` | 2 | Personas para sospechado (sin cambio). |
| `expire_suspected_minutes` | 60 | APROBADO 26/10/2026 (antes 45 en CLAUDE.md §7). Alineado con la ventana de votos (§3.1). |
| `incident_neighbor_k` | 1 | Radio `gridDisk` del conteo (7 celdas). |
| `incident_vote_window_min` | 60 | Vigencia de los votos de confirmación. |
| `incident_confirm_min_persons` | 3 | BLOQUEADA: no bajar de 3 (k-anonimato). |
| `incident_confirm_ratio` | 0,6 | BLOQUEADA por decisión de producto. |
| `incident_ask_max` | 40 | Máx. de preguntas por incidente (y por ronda de "¿Ya volvió?"). |
| `incident_ask_own_cell_first` | true | APROBADA 26/10/2026 (no propuesta): la pregunta va primero a los suscritos de la celda propia `c`, luego el resto de `U(c)`, siempre con relleno obligatorio (§2.6). |
| `incident_ask_filler_pct` | por fijar (> 0) | BLOQUEADA, mínimo > 0 (falla cerrado si es 0 o falta). Relleno OBLIGATORIO de celdas sin reportes (§2.6). El valor exacto: piloto (§11). |
| `incident_ask_delay_max_s` | 120 | Retraso aleatorio máximo de la pregunta. |
| `incident_anchor_required` | true | Al menos 1 "sí" de una persona ancla (cuenta > 24 h) en la celda mostrada (res 7: en su padre). |
| `incident_confirm_min_wait_min` | 5 | Espera mínima tras sospechado antes de confirmar. |
| `incident_ring_no_weight` | 0,5 | Peso del "no" de una persona cuya celda no es la del incidente. |
| `night_quiet_start` / `night_quiet_end` | 22:00 / 06:00 | APROBADO. Horario sin preguntas push (hora de Ecuador). |
| `night_ask_until_power_water` | 23:00 | APROBADO. Luz y agua se siguen preguntando hasta esta hora. |
| `night_publish_min_persons` | 5 | De noche se publica con >=5 personas... |
| `night_publish_min_anchors` | 2 | ...Y con >=2 anclas en modo `and` (además de k=3 y lo demás). |
| `night_publish_mode` | `and` | ENDURECIDO (§12): 5 personas Y 2 anclas. `or` no frenaba nada (medido 100 %, §8.3). |
| `night_review_deadline` | 06:30 | ENDURECIDO: lo publicado de noche expira si a esta hora no hay "sí" de >=2 personas que no participaron. |
| `night_first_round_at` | 06:00 | ENDURECIDO: primera ronda "¿Ya volvió?"/retracción de lo publicado de noche (las rondas nocturnas se suspenden). |
| `retract_enabled` | true | APROBADO. Activa la retracción (§2 regla 9). |
| `retract_min_no_persons` | 3 | PROVISIONAL (§13.1). Personas de la celda propia con "no" para retractar; solo cuentas y lugares >24 h, dedup por red, ponderadas por trust. |
| `retract_ratio` | 0,4 | PROVISIONAL (§13.1). La proporción sí/(sí+no) debe bajar de este valor. |
| `retract_ratio_basis` | `both` | La condición se evalúa sobre todos los votos Y sobre solo la celda propia. |
| `retract_first_ask_min` / `retract_ask_every_min` | 30 / 60 | Primera ronda de "¿Ya volvió?" tras confirmar y luego cada hora. |
| `retract_cooldown_h` | 6 | Tras retractar solo se republica con "sí" posteriores y de personas que no votaron en el retractado; NO bloquea votos nuevos (valor sin medir). |
| `incident_idle_cap_h` | 12 | Sin renovación en este plazo (y tras volver a preguntar), pasa a `expired`. |
| `incident_renew_min_persons` | 2 | ENDURECIDO. Renovar exige >=2 personas distintas (dedup por red) con "sí" nuevo de cuentas >24 h. |
| `incident_abs_cap_h` | 48 | ENDURECIDO. Techo absoluto (luz y agua) tras el cual se exige la regla de confirmación completa. |
| `resolve_min_persons` | 3 | ENDURECIDO. Personas (dedup por red, cuentas >24 h) con "ya volvió"/`back` para resolver. Un solo `back` nunca cierra. |
| `resolve_ratio` | 0,6 | ENDURECIDO. Proporción volvió/(volvió + sigue sin servicio) para resolver. |
| `incident_ask_per_net_max` | 1 | ENDURECIDO. Máx. de destinatarios de la pregunta por `net_hash` e incidente. |
| `incident_ask_null_net_max` | por fijar | ENDURECIDO. Cupo máximo compartido de cuentas con `net_hash` NULL por incidente. |
| `new_account_min_age_h` | 24 | Cuentas de menos edad: fuera de k y del muestreo; su "no" pesa 0,5. |
| `user_places_min_age_h` | 24 | Un lugar nuevo o cambiado no cuenta como ancla ni voto hasta pasado este tiempo. |
| `user_places_change_cooldown_h` | 24 | Cooldown entre cambios de un lugar. |
| `user_places_changes_per_day` | por fijar | Límite de cambios de lugares por día por usuario. |
| `user_places_max` | 3 | Lugares suscritos por usuario (casa, trabajo, otro). |
| `display_k_min` | 3 | BLOQUEADA >= 3. |
| `display_base_res` / `display_parent_res` | 8 / 7 | Resoluciones de muestra. |
| `display_promote_enabled` | true | Interruptor de agrupación a res 7. |
| `display_refine_min_persons` | 5 | Personas acumuladas en el disco para refinar de res 7 a res 8. |
| `display_refine_hold_min` | 10 | Espera antes de refinar. |
| `display_publish_bucket_s` | 300 | Cubo de publicación de cambios de zona y de Realtime. |
| `display_level_few_max` / `display_level_several_max` | por fijar | Cortes de los niveles pocos / varios / muchos (§11). |
| `adoption_min_pct` | 1 | Mínimo de adopción local por celda res 7 para publicar (§2, regla 7). |
| `adoption_min_account_age_d` | 7 | Antigüedad para contar en la adopción (ya sin la vía de "voto coincidente"). |
| `adoption_push_max_age_d` | 30 | ENDURECIDO. Solo cuentan cuentas con `last_success_at` de push dentro de este plazo. |
| `adoption_surge_factor` | por fijar | ENDURECIDO. Si el conteo de una celda res 7 crece más de N veces su mediana en un día: alerta y congelamiento de la compuerta. |
| `abuse_net_dedupe_enabled` | true | Cuentas de la misma `net_hash` = 1 persona por incidente. |
| `abuse_net_exempt_phone_verified` | false | DESACTIVADA: el OTP se hace después del lanzamiento (decisión aprobada 26/10/2026). |
| `abuse_net_exempt_phone_min_age_h` | 24 | Cuando haya OTP: teléfono verificado hace más de este tiempo. |
| `abuse_net_exempt_max_per_incident` | 3 | Cuando haya OTP: máximo de cuentas exentas por incidente y `net_hash`. |
| `abuse_net_hash_retention_days` | 7 | Poner `net_hash = NULL` pasado este plazo. |
| `abuse_net_alert_accounts` | 5 | ALERTA (no cambia pesos) si >=5 altas con la misma `net_hash` en la ventana. Medido: inútil en el pico (§8.5, propuesta en §11 punto 4). |
| `abuse_net_alert_window_min` | 60 | Ventana de esa alerta. |
| `abuse_net_ipv6_prefix` | 56 | Prefijo IPv6 de la red (a validar con datos del piloto). |
| `trust_zero_below` | 20 | Bajo este `trust_score` el peso es 0 sin avisar (valor a validar; hoy no hay dato). |

Eliminadas respecto a v1: `display_demote_extra_persons`, `display_demote_hold_min`, `display_min_dwell_min`.
Todas se leen de `config`, ninguna se hardcodea (regla 2 del agente). Las bloqueadas deben validarse al leerlas
(`>= 3`, `ratio == 0,6`, `incident_ask_filler_pct > 0`) y fallar cerrado si alguien las altera por error.

## 6. Modelo de abuso

**Hecho de partida:** k=3 personas era costoso de fabricar para el atacante cuando tenían que estar en la MISMA
celda. Con vecinas, 3 cuentas en cualquier parte de un disco de 7 celdas bastan. Con res 7, cuentas repartidas
en un padre de ~5 km2 fabrican una zona 7 veces mayor.

### 6.1 Cuentas falsas repartidas en las 7 celdas
- Sin ancla, 3 cuentas "juntas" fabrican hasta ~5 zonas res 8 (las celdas vecinas ven las 3 cuentas en su
  disco). Medido: 4,9 zonas con la regla b y 5,5 con la d, contra 1,0 con la original (§8.4).
- Con ancla el techo baja, pero la v2 mide que depende de cómo se reparten las preguntas (§8.4, §8.8): con preguntas
  al azar en toda la zona res 7 (la regla actual de §2.6), 3 cuentas de más de 24 h en redes distintas publican el 54 % de las veces
  (adopción 1 %); con preguntas primero a la celda propia, el 16 %.
- Dispersas (1 cuenta por celda en 3 celdas contiguas): con la regla original no confirma nunca; con vecinas
  sí (1,7 a 2,4 zonas). Con la v2 final y sin la compuerta de adopción: 1,3 a 1,5 zonas con 3 cuentas.
- Defensa de fondo: las 3 cuentas deben pasar el sospechado (2 reportes) y luego esperar a que los "no" de
  vecinos reales las diluyan (espera de 5 min). Esto funciona donde HAY usuarios reales alrededor y se les pregunta;
  en zonas con casi nadie la protección es parcial: de ahí el mínimo de adopción local (§2, regla 7).
- Cuentas nuevas: las cuentas de menos de 24 h no cuentan en k ni reciben preguntas (§2.5, §2.6). Medido: con cuentas
  nuevas el atacante fabrica 0,0 zonas en todos los casos (§8.4). Un atacante que espera 24 h antes de atacar sí cuenta (peor caso medido).
- Negación de servicio: cuentas de más de 24 h suscritas en la celda y respondiendo "no" pueden esconder un corte real (§8.4a).

### 6.2 Cuentas en la frontera de celdas
Un atacante con cuentas en dos celdas pegadas es indistinguible de un corte real que cruza el borde. Por diseño
el disco cubre ese caso, así que NO es un hueco nuevo salvo por lo anterior. Lo que sí hay que fijar: la celda
la calcula el cliente y el servidor no la corrige; no se reasigna por distancia; la celda de origen se fija al crear
el incidente (§1.1); y las cuentas en la frontera de dos padres res 7 se evalúan con `U(c)` solo desde el origen del
incidente (no se unen dos padres).

### 6.3 Defensa por red (`net_hash`)
**Cálculo.**
- La red se toma SOLO de la cabecera de IP fijada por Vercel (`x-real-ip` / `x-vercel-forwarded-for`), nunca de
  cabeceras enviadas por el cliente.
- Sin IP válida, `net_hash` queda NULL: la cuenta cuenta como persona separada con peso 0,5.
- Red = IPv4 /24; IPv6 /56 (no /48), a validar con datos del piloto.
- `net_hash = trunc64( HMAC-SHA256( clave_diaria, red ) )`, con `clave_diaria = HKDF(secreto_net_hash, fecha_EC)` donde
  `fecha_EC` es la fecha en hora de Ecuador. La clave diaria es derivada y NO se guarda en la BD. `secreto_net_hash`
  es un secreto de servidor distinto de los demás (no es la `service_role key` ni el de VAPID), nunca
  `NEXT_PUBLIC_*`, con procedimiento de rotación en el runbook de filtración de credenciales.
- El hash se trunca a 64 bits (suficiente para agrupar, reduce la capacidad de reidentificar).
- Rotación diaria entre las 03:30 y las 04:30 (hora de Ecuador, horario silencioso): en esa franja se compara con la
  clave anterior y la actual. Un incidente conserva la clave vigente al pasar a sospechado. Una persona con votos
  desde dos `net_hash` distintos cuenta con el `net_hash` de su PRIMER voto en el incidente.

**Almacenamiento y privacidad.**
- Se guarda en `reports`, `confirmations` y en la tabla nueva `anon_signups (id, user_id, net_hash, created_at)`. El
  alta anónima ocurre en Supabase (Supabase Auth no permite columnas extra), así que la fila se registra desde `/api/v1`
  al crear la sesión.
- Es PSEUDONIMIZACIÓN, no anonimización, mientras exista `user_id` en la misma fila (dato personal bajo LOPDP).
- Borrado a `abuse_net_hash_retention_days` (7): un job pone `net_hash = NULL` (los reportes viven 90 días); también en
  `anon_signups`. Borrado inmediato al eliminar la cuenta.
- El `net_hash` NO sale de ese ciclo de 7 días por la puerta de atrás: la tabla de votos de incidentes no lo guarda ni deriva de él su `person_key`
  (es un identificador aleatorio por incidente, §2, §7.1). Los pasos de agrupación por red usan el `net_hash` de `reports`/`confirmations` mientras exista.
- Backups/PITR retienen el valor más de 7 días; esto se declara en la política de privacidad.
- Las claves de rate limit en Redis hoy con IP en claro pasan a usar el mismo HMAC, con TTL <= 1 h. Si el secreto
  HMAC no está disponible, las rutas de escritura fallan cerradas (503), igual que si Redis no responde.
- Nunca se expone ni se loguea.

**Uso.**
1. **Conteo**: dentro de un incidente, las cuentas con la misma `net_hash` cuentan como UNA persona (sospechado y
   confirmado, sí y no). 3 cuentas de la misma red = 1 persona = no confirma. Si el grupo de una misma red tiene votos
   mixtos, gana el "no" (conservador). Cuenta la ÚLTIMA respuesta de cada persona.
2. **Alerta, no peso**: con >= `abuse_net_alert_accounts` (5) altas de una `net_hash` en 60 min SOLO se dispara una
   ALERTA de abuso (§12 de CLAUDE.md). No cambia pesos por sí sola. Motivo: en un pico real (apagón masivo, CGNAT en
   datos móviles) muchas cuentas honestas nuevas comparten red; bajarles a peso 0 sería un falso positivo en el
   momento de más valor. La defensa es la deduplicación por incidente. Medido en v2 (§8.5): con 1.000 altas por hora y 20 a 100 redes móviles la alerta
   salta para el 51 % a 90 % de las altas honestas; con ese umbral deja de servir en el pico (propuesta en §11, punto 4).
3. **Exención por teléfono verificado: DESACTIVADA.** El OTP de teléfono se hace después del lanzamiento (decisión aprobada
   26/10/2026). Hasta entonces la deduplicación por red aplica a TODAS las cuentas. Cuando exista, solo "teléfono verificado hace > 24 h" y
   máximo 3 cuentas exentas por incidente y `net_hash`.
4. **Validación**: el experimento de falsos positivos con altas honestas en el pico está hecho en la v2 (§8.5).

Limitaciones honestas:
- Datos móviles con CGNAT: durante un apagón mucha gente está en datos móviles y varias personas reales
  pueden compartir /24. Medido en v2 con un modelo supuesto (no validado con datos reales de redes de Guayaquil): con 90 % en datos
  móviles y solo 10 redes /24, la celda de origen pierde el 38 % de las personas por deduplicación y un corte de 1 celda se ve el 70 %
  de las veces en vez del 85 %; con 100 redes la pérdida es del 5 % y el efecto desaparece. En cortes de 7+ celdas no hay efecto visible.
- No frena a un atacante con redes distintas (VPN, varias líneas móviles). Con 3 redes distintas, 3 cuentas
  siguen contando como 3 personas (medido). Para eso quedan: ancla, espera mínima, "no" vecinos, captcha de alta de
  sesión, cuentas < 24 h fuera de k, retracción, límites de §12 y la alerta de patrones.
- Un atacante con 1 o 2 redes no logra publicar nada (0,0 zonas en todas las corridas de v2, §8.4); con 3 redes sí.

### 6.4 Usuario suscrito en varias celdas
- Una persona cuenta una vez por incidente (clave `user_id`), pero puede recibir preguntas de incidentes
  distintos si tiene lugares en celdas distintas. Sin inflar k de un mismo incidente.
- Un atacante con 1 cuenta y `user_places_max = 3` solo puede estar en 3 discos; no puede acumular 3 "personas".
- La ubicación del voto es el LUGAR suscrito (con más de 24 h), no donde está la persona hoy. Responder "sí" por un
  lugar donde no se está equivale a reportar falso; el control es el trust_score y que "No estoy en casa" no cuente.
- Para el ancla se usa el lugar suscrito con más de 24 h, o la celda del reporte (§2, definición de ancla).

## 7. Pruebas obligatorias (las escribiría `incident-logic` al implementar)

Pruebas diferenciales: los mismos escenarios corren en vitest (modelo de referencia TS en `src/lib/incidents/`) y en
pgTAP (motor SQL, §7.1) y deben dar el mismo resultado. Umbrales inyectados desde `config`.

1. Celda sola con 3 personas (con ancla) -> confirma. 2 en celda + 1 en vecina -> confirma (b). 2 + 1 en celda a distancia 2 -> no.
2. Votos a los 59 min cuentan, a los 61 no; el reporte a los 16 min no pasa a sospechado. Sospechado sin confirmar a los 60 min -> `expired`; un "sí" en el minuto 50 todavía cuenta.
3. 3 "sí" + 4 "no" -> no confirma; "No estoy en casa" no cuenta a favor ni en contra.
4. 3 cuentas misma `net_hash` -> 1 persona (con y sin teléfono verificado mientras no haya OTP); 3 en 3 redes -> 3.
   Grupo de una red con votos mixtos -> gana el "no"; cuenta la última respuesta.
5. Refinamiento: 3 personas -> res 7; sube a 4 -> sigue res 7; >=5 y 10 min -> res 8; nunca baja de res 8 a res 7.
6. Nunca sale una zona con < 3 personas en el disco; el payload del mapa no contiene `user_id`, `net_hash` ni conteos exactos.
7. Un usuario con lugares en 3 celdas cuenta 1 vez. Idempotencia por `client_request_id`.
8. Internet: Netlife en una celda no marca CNT; apagón masivo (500 reportes en 5 min, 20 celdas) sin duplicados
   ni saturar notificaciones (máx. 40 preguntas/incidente, 3/usuario/día, 1/incidente).
9. 10 cuentas nuevas de la misma red -> no confirma y dispara ALERTA (sin cambiar pesos por sí sola).
10. `published_zones` sin fuga: `anon`/`authenticated` no leen `origin_cell`, `distinct_users`, `started_at` ni filas de
    `incidents`; Realtime solo emite `published_zones` y en el cubo de 5 min (pgTAP).
11. Pregunta neutra con relleno: el texto no nombra celda ni sector; hay destinatarios de celdas sin reportes; retraso
    aleatorio de 0 a 2 min; el destinatario no puede deducir si hay reportes cerca.
    11b. Reparto aprobado (26/10/2026): la pregunta llega PRIMERO a los suscritos de la propia celda `c` y luego al resto de `U(c)`, pero el relleno de celdas sin
    reportes nunca es 0 (con `incident_ask_filler_pct` en 0 o ausente falla cerrado y no se envía nada), el texto no nombra celda ni sector, hay máximo 1 destinatario
    por `net_hash` por incidente, y las cuentas de menos de 24 h quedan excluidas.
12. `net_hash` NULL sin IP válida (cabecera ausente o enviada solo por el cliente); la cuenta pesa 0,5 y cuenta separada.
13. Claves bloqueadas fallan cerrado (secreto HMAC ausente, config alterada: `k < 3`, ratio distinto de 0,6).
14. Retracción: (a) incidente confirmado con 3 "sí" de atacante; llegan 3 "no" de la celda propia y la proporción baja de 0,4 -> `expired`
    y desaparece de `published_zones` en el siguiente cubo; (b) 2 "no" -> sigue; (c) 3 "no" pero proporción entre 0,4 y 0,6 -> sigue;
    (d) corte real que afecta al 60 % de una celda -> NO se retracta (se evalúan las dos proporciones); (e) los "no" de cuentas de la misma red
    cuentan como uno; (f) borrar una cuenta no retracta ni oculta (contadores materializados); (g) durante `retract_cooldown_h` NO se bloquean votos
    nuevos: se republica con la regla normal usando solo "sí" posteriores a la retracción y de personas que no votaron en el retractado, y los mismos votos
    falsos no republican; (h) las respuestas "¿Ya volvió?" de quien no votó cuentan como "no" del incidente; (i) cuentas con <24 h de cuenta o de lugar
    no cuentan para el N de retracción; 5 cuentas >24 h en redes distintas diciendo "no" sobre un corte real (ataque de retracción): el resultado es el
    fijado por la simulación de §13.1 (hasta entonces el test está marcado pendiente).
15. Noche: (a) corte que empieza a las 23:00, 02:00 -> no se envían preguntas (salvo luz/agua hasta las 23:00); (b) 3 personas con 1 ancla
    a las 02:00 -> no publica; 5 personas con 1 ancla -> no publica; 5 personas Y 2 anclas -> publica (modo `and`, valor inicial); con `or` bastaría una de las dos;
    (c) las rondas "¿Ya volvió?" y de retracción no se envían de noche; la primera ronda de lo publicado de noche sale a las 06:00 exactas;
    (d) a las 22:30 solo se preguntan luz y agua (internet e inundación no; inundación severa según CLAUDE.md §8); a las 23:30 no se pregunta luz ni agua;
    (e) la hora se evalúa en hora de Ecuador al confirmar; (f) revisión de la mañana: un incidente publicado a las 02:00 expira a las 06:30 si no hay "sí" de
    >=2 personas que no participaron, y sigue si los hay (dedup por red, cuentas >24 h).
16. Cuentas de menos de 24 h: fuera de k y del muestreo; su "no" pesa 0,5; un lugar cambiado hace menos de 24 h no cuenta.
17. Incidente creado con origen fijo: un reporte posterior en otra celda no mueve `c`; el índice único parcial impide duplicados.
18. Reporte en dos discos: va al incidente de origen más cercano; empate = menor id.
19. Inundación res 10 agregada a res 8: la zona publicada nunca es res 10; foto de trust alto sola no cuenta (>=3 usuarios distintos).
20. Supresión de cuenta: se eliminan sus `reports`/`confirmations`/`anon_signups`; ninguna zona publicada se oculta ni cambia, y los contadores
    materializados de confirmación, retracción y resolución no cambian (borrar 3 cuentas que votaron "no" no retracta; borrar cuentas que votaron "sí" no
    confirma ni deshace; borrar cuentas de "ya volvió" no resuelve ni reabre).
21. Borrado de `net_hash` a 7 días (job) y al eliminar cuenta: tras el job no queda `net_hash` en `reports`, `confirmations`, `anon_signups` ni en la tabla
    de votos; `person_key` es aleatorio por incidente y no se puede derivar del `net_hash` (dos incidentes con la misma red tienen `person_key` distintos).
22. Rotación de clave entre 03:30 y 04:30: un incidente conserva la clave vigente al pasar a sospechado; una persona con votos desde dos `net_hash` cuenta con el del primer voto.
23. Bordes de H3: reportes en celdas vecinas por `gridDisk` k=1 y tablas `h3_neighbors`/`h3_parent` iguales a `h3-js`.
24. Mínimo de adopción local: por debajo de ~1 % en la celda res 7 no se publica; solo cuentan cuentas de más de 7 días con push activo (`last_success_at` <= 30 días);
    una cuenta con lugares en varias celdas cuenta una vez, en su lugar más antiguo; un voto coincidente con un incidente confirmado NO cuenta como adopción;
    si el conteo de una celda res 7 crece más de N veces su mediana en un día, se dispara alerta y la compuerta se congela.
25. Tope de visibilidad: incidente confirmado sin renovación durante 12 h -> se pregunta de nuevo -> si nadie renueva, `expired`; un "sí" de cuenta nueva no renueva;
    un solo "sí" (o dos cuentas de la misma red) tampoco renueva; con >=2 personas de redes distintas y cuentas >24 h sí renueva; tras 48 h (luz y agua) se exige la
    regla de confirmación completa aunque haya renovaciones.
26. Corte que vuelve: resolución por "ya volvió" y por reportes `back` solo con >=3 personas (dedup por red, cuentas >24 h) y proporción >=0,6; UN solo reporte `back`
    NUNCA cierra un incidente (ni 5 `back` de cuentas de la misma red); "todavía sin luz" cuenta como "no" y renueva la visibilidad; corte de más de 12 h se vuelve a
    preguntar antes de cerrar; borrar cuentas no resuelve.
27. Preguntas: máximo 1 destinatario por `net_hash` por incidente; las cuentas con `net_hash` NULL comparten un cupo máximo; `incident_ask_filler_pct = 0` o ausente ->
    falla cerrado (no se envían preguntas).
28. Realtime: el canal es Broadcast del job con contenido de `published_zones`; no existe publicación `postgres_changes` sobre `incidents`.

### 7.1 Motor (dónde se ejecuta)
- El motor se ejecuta en SQL: un job de `pg_cron` cada 10 a 15 s con `pg_try_advisory_lock`, que procesa los reportes
  nuevos desde una marca de agua (`id`). Sin trigger por fila (no hace falta lock por reporte en el pico de 500/s).
- Tabla de votos con upsert por `(incident_id, person_key)`, donde `person_key` es un identificador ALEATORIO por incidente, no derivado de `net_hash` ni de
  `user_id` (decisión: así el `net_hash` no sobrevive los 7 días ni complica la supresión de cuenta). Una tabla auxiliar privada por incidente liga
  `user_id -> person_key` y se borra al eliminar la cuenta; la agrupación por red se resuelve al votar con el `net_hash` vigente y se guarda solo como
  `person_key` compartido. La última respuesta reemplaza a la anterior.
- Los contadores y proporciones (confirmación, retracción, resolución, renovación) se materializan en el incidente y no se recalculan al borrar cuentas (§4.4).
- Realtime: el job publica en un canal Broadcast el contenido de `published_zones`; no se usa `postgres_changes`.
- El TS en `src/lib/incidents/` es solo el modelo de referencia y de pruebas diferenciales, no corre en producción.
- Vecinos y padres H3: tablas `h3_neighbors(cell, neighbor)` y `h3_parent(cell8, cell7)` (más los hijos de cada res 7)
  generadas con `h3-js` en una migración, con test contra `h3-js`. Antes de decidir, verificar con
  `select name from pg_available_extensions where name like 'h3%'` (no asumir que la extensión existe en Supabase).
- Las inundaciones se guardan en res 10 pero entran al disco agregadas siempre en su celda padre res 8.
- Cualquier cambio de esquema o funciones lo ejecuta `db-supabase`, con RLS y pgTAP en el mismo PR.

## 8. Resultados de la simulación v2 (`scripts/sim/umbrales.mjs`)

**Reproducir** (desde la raíz del repo; Node v24.16.0, sin dependencias nuevas, usa `h3-js`):

```
node scripts/sim/umbrales.mjs --trials 300 --atk-trials 100 --ret-trials 600
```

Semilla fija 20261026 (por defecto; se cambia con `--seed N`). Repeticiones: 300 por celda de las tablas de corte real y horario,
100 por celda de ataque, hasta 200 incidentes falsos publicados (con tope de 3.000 intentos) en la retracción de atacante y 600 en la de corte real.
Tiempo de ejecución: 752 s (12,5 min) en la corrida de referencia. Con `--full` se añaden las 9 combinaciones de respuesta/reporte en cada tabla (la versión anterior del script tardó 14 min con `--full`; ahora tarda algo más).
Es una comparación PAREADA: en cada repetición todas las reglas ven exactamente el mismo mundo (mismos usuarios, mismos retrasos,
mismas respuestas), así que las diferencias entre reglas son más fiables que las cifras sueltas. Con 300 repeticiones, una cifra
cerca del 50 % tiene un margen de unos +-6 puntos (95 %); entre reglas pareadas el margen es menor, pero no se calculó.

### 8.1 Qué es medido y qué es supuesto

MEDIDO por el script: la probabilidad de que el corte quede visible, la cobertura (qué fracción de las celdas con corte se pinta), las celdas sin
corte que se pintan, las zonas falsas de un atacante y los tiempos de retracción, DADOS los supuestos de abajo.
SUPUESTO (no medido, hay que reemplazarlo con datos reales del lanzamiento):
- 5.000 personas por celda; densidad de usuarios idéntica en todas las celdas (en la realidad el lanzamiento
  concentrado la hace más alta en 3 a 5 ciudadelas y casi nula fuera). "Adopción" = veteranos; además hay un 10 % extra de cuentas nuevas (<24 h).
- 70 % de los usuarios en casa durante el corte (el resto responde "No estoy en casa"/no reporta).
- Reporte espontáneo: retraso exponencial, media 8 min. Respuesta al push: retraso exponencial, media 5 min (§8.7 prueba 25 min).
- La tasa de respuesta (40 % central) y de reporte (5 % central) se aplican a los usuarios de la app afectados.
- El reporte original cuenta como un "sí". Todos los usuarios con peso 1 (trust uniforme, sin shadow limit).
- Los vecinos no afectados que responden dicen "no". En redes: 60 % en datos móviles (90 % en §8.5), 200 redes /24 móviles, la exención por teléfono está desactivada.
- Respuesta honesta equivocada: 0 % en visibilidad (§8.2 a §8.6) y 5 % en retracción (§8.7).
- Los reportes y respuestas de noche son iguales que de día (optimista: de noche se reporta menos).
- El atacante reporta en los primeros 5 min; tiene captcha/rate limit superado; sus cuentas tienen peso 1 y, en el peor caso, más de 24 h y lugar suscrito de más de 24 h.
- El atacante usa una red distinta por cuenta salvo que se diga lo contrario.
- Internet por proveedor: la pregunta solo llega a quien declaró ese proveedor (hoy el modelo de datos no lo guarda, ver §9).
- Altas por IP: 8 IP de salida por cada red /24 móvil.
- Relleno de preguntas (`incident_ask_filler_pct`) NO modelado (abierto, §11). Refinamiento 7 -> 8 de §4.1 NO modelado.
- Regla a (original) corregida respecto de la v1: el sospechado exige las 2 personas en la MISMA celda (v1 usaba el disco). Cambia de 45 a 42 % (1 celda, 1 %).

Reglas comparadas (siempre en la misma columna): a = original (3 en la misma celda, 15 min); b = vecinas; c = vecinas + 60 min;
d = c + res 7; e = d + protecciones de la v1 (ancla, espera, "no" a 0,5, preguntas primero a la celda propia; sin edad de cuenta, sin
dedup. por red); **f = v2 final**: todo lo aprobado (ancla con cuenta >24 h, espera 5 min, "no" a 0,5, cuentas <24 h fuera, dedup. por red con "no" gana,
preguntas al azar en toda la zona res 7 con retraso de 0 a 2 min, sospechado a 60 min, cubo de publicación de 5 min, compuerta de adopción 1 %, regla de noche).
fn = f sin la compuerta de adopción. Variantes (solo caso central): g = f con sospechado a 45 min; h = f con las preguntas primero a la celda propia;
w = f con la mitad de las preguntas a la celda propia; fd = f con la regla de día también de noche; fs = noche estricta (5 personas Y 2 anclas);
fs8 = (8 personas Y 2 anclas); fx = f sin dedup. por red.

### 8.2 Corte real: probabilidad de verse a los 60 min y cobertura (día, 12:00, respuesta 40 %, reporte espontáneo 5 %)

"Visible" = al menos una celda del corte publicada. "Cobertura" = % de las celdas con corte que quedan publicadas (60 min). Columnas a / b / c / d / e / f / fn.

| Corte | Adopción | Visible 60 min (a/b/c/d/e/f/fn) | Cobertura 60 min (a/b/c/d/e/f/fn) |
|---|---|---|---|
| 1 celda | 0,1 % | 2/1/1/1/1/0/1 | igual que visible |
| 1 celda | 0,5 % | 19/10/10/11/22/0/13 | igual |
| 1 celda | 1 % | 42/25/25/27/51/29/29 | igual |
| 1 celda | 3 % | 95/70/66/75/98/84/84 | igual |
| 7 celdas | 0,1 % | 9/36/36/36/36/0/32 | 1/17/17/19/23/0/21 |
| 7 celdas | 0,5 % | 77/99/99/99/99/0/97 | 19/88/88/89/89/0/88 |
| 7 celdas | 1 % | 99/100/100/100/100/100/100 | 45/99/98/99/99/98/98 |
| 7 celdas | 3 % | 100 en todas | 95/100/100/100/100/100/100 |
| 37 celdas | 0,1 % | 35/94/94/94/94/0/91 | 1/27/28/41/42/0/40 |
| 37 celdas | 0,5 % | 100/100/100/100/100/0/100 | 18/94/94/97/95/0/97 |
| 37 celdas | 1 % | 100 en todas | 45/100/100/100/100/100/100 |
| 37 celdas | 3 % | 100 en todas | 95/100/100/100/100/100/100 |

Con 15 y 30 min las cifras son casi iguales (la confirmación llega pronto o no llega); a 120 min tampoco cambian.

Celdas SIN corte pintadas por error (promedio, a 60 min; a/b/c/d/e/f/fn). Casi todo lo que pinta f viene de la agrupación a res 7 (§8.8).

| Corte | Adopción | Celdas sin corte pintadas | % de pruebas con alguna |
|---|---|---|---|
| 1 celda | 1 % | 0,0/1,4/1,5/1,6/0,1/1,1/1,1 | 0/34/34/38/1/19/19 |
| 1 celda | 3 % | 0,0/4,0/3,9/4,3/0,7/4,1/4,1 | 0/86/84/88/12/68/68 |
| 7 celdas | 1 % | 0,0/5,5/5,4/8,9/1,5/10,9/10,9 | 0/100/100/100/37/100/100 |
| 7 celdas | 3 % | 0,0/9,9/9,6/13,0/9,0/13,8/13,8 | 0/100/100/100/100/100/100 |
| 37 celdas | 1 % | 0,0/13,8/13,6/22,7/3,8/22,9/22,9 | 0/100/100/100/73/100/100 |
| 37 celdas | 3 % | 0,0/21,5/21,1/28,7/20,1/25,8/25,8 | 0/100/100/100/100/100/100 |

Sensibilidad (1 celda, f, visible a 60 min): con respuesta 20 % y reporte 2 % (caso bajo) 9 % a 1 % de adopción y 42 % a 3 %; con respuesta 60 % y reporte 15 % (caso alto) 66 % y 100 %.

Variantes (1 celda, caso central, visible a 60 min): a 1 % de adopción f 29, g 29, h 46, w 45, fx 30; a 3 %, f 84, g 84, h 97, w 97, fx 85. En cortes de 7 y 37 celdas con adopción >=1 %, todas dan 100 %.

Lectura sencilla:
- Con adopción de 1 % o más, los cortes de 7 celdas o más se ven casi siempre en todas las reglas, y la v2 final cubre 98 a 100 % de las celdas afectadas.
- Los cortes de UNA celda son el punto débil: con 1 % de adopción la regla original los muestra el 42 % de las veces y la v2 final el 29 %.
- La compuerta de adopción (1 %) deja la v2 final en 0 % con adopción de 0,5 % o menos, aun en cortes grandes (fn, sin compuerta, mostraría 97 % a 100 %).
- Pintar de más: en un corte de 7 celdas con 1 % de adopción, la v2 final pinta unas 11 celdas sin corte (el corte real cubre 7). Es el costo de agrupar a res 7 sin exclusividad.

### 8.3 Horario: corte de noche y ataque de noche

Corte real, visible a 60 min (caso central; con 120 min es igual). Columnas a / e / fd / f / fs / fs8 / fn.

| Corte | Adopción | Inicio | a | e | fd | f | fs | fs8 | fn |
|---|---|---|---|---|---|---|---|---|---|
| 1 celda | 1 % | 12:00 | 48 | 56 | 32 | 32 | 32 | 32 | 32 |
| 1 celda | 1 % | 22:30 | 41 | 51 | 30 | 30 | 13 | 1 | 30 |
| 1 celda | 1 % | 23:00 | 27 | 31 | 25 | 25 | 3 | 0 | 25 |
| 1 celda | 1 % | 02:00 | 29 | 34 | 30 | 30 | 6 | 0 | 30 |
| 1 celda | 3 % | 12:00 | 95 | 96 | 84 | 84 | 84 | 84 | 84 |
| 1 celda | 3 % | 22:30 | 96 | 97 | 85 | 85 | 70 | 35 | 85 |
| 1 celda | 3 % | 23:00 | 90 | 94 | 90 | 90 | 54 | 12 | 90 |
| 1 celda | 3 % | 02:00 | 90 | 94 | 90 | 90 | 62 | 18 | 90 |
| 7 celdas | 1 % | 23:00 / 02:00 | 86 / 88 | 100 | 100 | 100 | 100 | 92 / 95 | 100 |

Otras filas medidas: 7 celdas con 1 % a las 12:00 y 22:30, a da 97 y 99 y el resto 100; 7 celdas con 3 % y 37 celdas con 1 % y 3 %, todas las reglas dan 100 a cualquier hora. Con la regla de noche aprobada (`or`, columna f) un corte real de noche se ve igual que con la regla de día (fd).

Ataque: 3, 5 u 8 cuentas falsas con más de 24 h, en redes distintas, juntas en una celda. % de pruebas en que se publica una zona falsa (zonas promedio entre paréntesis). Columnas e / fd / f / fs / fs8 / h / w.

| Cuentas | Hora | Honestos | e | fd | f | fs | fs8 | h | w |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 12:00 | 1 % | 6 | 54 | 54 | 54 | 54 | 16 | 35 |
| 3 | 12:00 | 3 % | 6 | 60 | 60 | 60 | 60 | 22 | 28 |
| 3 | 02:00 | 1 % y 3 % | 100 | 100 | 100 | 0 | 0 | 100 | 100 |
| 5 | 12:00 | 1 % | 17 | 85 | 85 | 85 | 85 | 40 | 67 |
| 5 | 02:00 | 1 % y 3 % | 100 | 100 | 100 | 100 | 0 | 100 | 100 |
| 8 | 12:00 | 1 % | 73 | 100 | 100 | 100 | 100 | 92 | 96 |
| 8 | 02:00 | 1 % y 3 % | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

Lectura sencilla:
- De noche nadie contradice (no hay preguntas), así que publicar es igual de fácil para un corte real y para uno falso. La regla original aprobada (5 personas o 2 anclas, modo `or`, ya reemplazada por `and`, §2 regla 8) no frenaba a un atacante: 3 cuentas con más de 24 h bastan (100 %), porque son 3 anclas.
- La versión estricta "Y" (fs) frena a 3 cuentas pero no a 5; la de 8 (fs8) frena a 5 pero no a 8, y cuesta cortes reales: con 1 % de adopción un corte de 1 celda de noche pasa de 30 % a 0 %.
- De día, con preguntas al azar (f), 3 cuentas de más de 24 h publican el 54 % de las veces; con preguntas primero a la celda propia (h), el 16 %.

### 8.4 Atacante

**4a. Acaparar las preguntas y esconder un corte real** (honestos 3 %, corte real de 1 celda, f; las cuentas del atacante responden "no" y están en 5 redes):

| Cuentas del atacante | Tipo | Preguntas ocupadas (de 40) | Corte real visible a 60 min |
|---|---|---|---|
| 0 | ninguna | 0,0 | 83 % |
| 50 / 200 / 1.000 | nuevas (<24 h) | 0,0 / 0,0 / 0,0 | 80 / 81 / 81 % |
| 50 | con más de 24 h | 1,2 | 77 % |
| 200 | con más de 24 h | 5,0 | 39 % |
| 1.000 | con más de 24 h | 16,0 | 9 % |

Las cuentas nuevas no hacen nada (excluidas del muestreo). Las de más de 24 h sí: 200 cuentas bastan para esconder el corte real más de la mitad de las veces.

**4b. Zonas falsas visibles** (promedio de zonas; km2 entre paréntesis), cuentas del atacante con más de 24 h, una red por cuenta, grupos de 3. Columnas a / b / d / e / f / fn / w / wn / h / hn (n = sin compuerta de adopción):

| Honestos | Estrategia | Cuentas | a/b/d/e | f / fn | w / wn | h / hn |
|---|---|---|---|---|---|---|
| 0,1 % | juntas | 30 | 9,9 / 45,1 / 51,4 / 3,6 | 0,0 / 5,6 (23 km2) | 0,0 / 5,5 | 0,0 / 5,5 |
| 0,1 % | dispersas | 30 | 0,0 / 19,4 / 17,1 / 7,4 | 0,0 / 11,6 (13 km2) | 0,0 / 10,9 | 0,0 / 10,9 |
| 0,5 % | juntas | 30 | 9,9 / 42,2 / 50,1 / 1,3 | 0,0 / 4,9 (18 km2) | 0,0 / 3,5 | 0,0 / 3,0 |
| 0,5 % | dispersas | 30 | 0,0 / 18,0 / 17,2 / 1,5 | 0,0 / 11,9 (13 km2) | 0,0 / 4,8 | 0,0 / 3,8 |
| 1 % | juntas | 3 | 1,0 / 3,8 / 4,7 / 0,1 | 0,5 / 0,5 | 0,3 / 0,3 | 0,2 / 0,2 |
| 1 % | juntas | 30 | 9,9 / 42,1 / 50,4 / 0,9 | 5,4 (20 km2) / 5,4 | 3,4 / 3,4 | 1,7 / 1,7 |
| 1 % | dispersas | 30 | 0,0 / 18,4 / 17,6 / 0,5 | 11,9 (13 km2) / 11,9 | 4,3 / 4,3 | 1,3 / 1,3 |

- Con cuentas NUEVAS (menos de 24 h) el atacante fabrica 0,0 zonas en todos los casos (columna "f (cuentas nuevas)" de la corrida).
- Defensa por red: con 1 o 2 redes, 0,0 zonas en todos los casos, N = 3, 12 y 30. Con una red por cuenta, ver tabla.
- Con adopción de 0,1 % y 30 cuentas dispersas, la regla e de la v1 da 7,4 zonas (la verificación del revisor dio 9,5); con la compuerta de adopción, 0,0.
- Con adopción de 1 % (justo en el mínimo), la v2 final deja pasar más abuso que la e de la v1 (5,4 contra 0,9 zonas con 30 cuentas juntas; 11,9 contra 0,5 dispersas). La causa es el reparto de preguntas al azar: h (preguntas primero a la celda propia) da 1,7 y 1,3.

**4c. Compuerta de adopción**: para destrabar una zona res 7 (35.000 habitantes, mínimo 1 %) con honestos al 0,1 % el atacante necesita unas 315 cuentas de más de 7 días; con honestos al 0,5 %, unas 176.

### 8.5 Altas honestas en el pico (CGNAT)

Una hora de pico con S altas honestas nuevas; las móviles comparten pocas redes /24 (8 IP de salida por /24). Alerta = 5 altas de la misma red en 60 min. Límite = 60 altas por hora por IP (CLAUDE.md §12).

| Altas por hora | % móvil | Redes /24 móviles | % de altas honestas en redes con alerta | Alertas por hora | % de altas bloqueadas por el límite por IP |
|---|---|---|---|---|---|
| 20 (día normal) | 60 / 90 | 20 a 500 | 0 a 1 | 0 | 0 |
| 1.000 | 60 | 20 / 100 / 500 | 60 / 51 / 2 | 20 / 72 / 4 | 0 |
| 1.000 | 90 | 20 / 100 / 500 | 90 / 88 / 10 | 20 / 95 / 18 | 0 |
| 5.000 | 60 | 20 / 100 / 500 | 60 / 60 / 51 | 20 / 100 / 358 | 0 |
| 5.000 | 90 | 20 / 100 / 500 | 90 / 90 / 88 | 20 / 100 / 472 | 0 |
| 20.000 | 60 | 20 / 100 / 500 | 60 / 60 / 60 | 20 / 100 / 500 | 12 / 0 / 0 |
| 20.000 | 90 | 20 / 100 / 500 | 90 / 90 / 90 | 20 / 100 / 500 | 42 / 0 / 0 |

Costo de la deduplicación por red en un corte real (adopción 3 %, caso central). Visible a 60 min con deduplicación (f) / sin ella (fx) y % de personas perdidas en el conteo de la celda de origen:

| Corte | % móvil | Redes /24 | f visible | fx visible | Personas perdidas |
|---|---|---|---|---|---|
| 1 celda | 60 | 10 / 30 / 100 | 79 / 80 / 81 | 85 / 81 / 83 | 18 / 7 / 2 % |
| 1 celda | 90 | 10 / 30 / 100 | 70 / 76 / 80 | 85 / 81 / 83 | 38 / 17 / 5 % |
| 7 celdas | 60 y 90 | 10 a 100 | 100 | 100 | 4 a 52 % (sin efecto en lo visible) |
| cualquiera | cualquiera | una por usuario | 83 (1 celda) / 100 | igual | 0 % |

Lectura sencilla:
- La alerta por red (5 altas por hora) es inútil en un pico: se dispara para casi todas las altas honestas móviles. No afecta pesos, así que no se pierde a nadie, pero deja de servir como señal de abuso justo cuando más se la necesita.
- La deduplicación por red solo duele en cortes de 1 celda cuando hay muy pocas redes móviles (10 a 30): el corte se ve 5 a 15 puntos menos. Con 100 redes o más casi no cambia.
- El límite de 60 altas por hora por IP bloquearía a usuarios honestos solo en picos muy fuertes (20.000 altas por hora con pocas IP de salida: 12 % a 42 % bloqueados). Con menos altas o más IP, 0 %.
- Las altas del pico son cuentas nuevas (menos de 24 h): de todos modos no cuentan en k ni reciben preguntas durante su primer día.

### 8.6 Internet por proveedor (adopción repartida entre 5 proveedores)

Visible a 60 min / cobertura a 60 min (caso central, adopción total 1 % y 3 %, la compuerta usa la adopción total). Columnas a / e / f. Cuotas supuestas: Netlife 35 %, CNT 25 %, Claro 20 %, proveedor chico 10 %.

| Corte | Adopción | Sin dividir (como luz) | Netlife | CNT | Claro | Chico |
|---|---|---|---|---|---|---|
| 1 celda | 1 % | 43 / 51 / 30 | 10 / 12 / 6 | 6 / 7 / 4 | 5 / 5 / 3 | 1 / 1 / 1 |
| 1 celda | 3 % | 94 / 97 / 82 | 50 / 58 / 35 | 34 / 39 / 23 | 22 / 29 / 14 | 8 / 10 / 5 |
| 7 celdas | 1 % | 99 / 100 / 100 | 59 / 95 / 94 | 36 / 87 / 81 | 24 / 74 / 67 | 6 / 35 / 31 |
| 7 celdas | 3 % | 100 / 100 / 100 | 99 / 100 / 100 | 94 / 100 / 100 | 83 / 99 / 99 | 44 / 90 / 86 |

(La cobertura de f en 7 celdas es 78 / 62 / 48 / 20 % para Netlife / CNT / Claro / chico con 1 %, y 99 / 96 / 92 / 68 % con 3 %.) Internet casi no se ve en el piloto: una caída de un proveedor
en una celda se publica pocas veces aun con 3 % de adopción total, y solo los cortes de varias celdas con proveedores grandes se ven de forma fiable.

### 8.7 Retracción, tope duro y expiración a 60 min

**Falso publicado por un atacante** (cuentas con más de 24 h juntas en una celda, una red por cuenta; solo los casos en que logró publicar; 200 incidentes por fila). Tiempo desde la publicación hasta ocultarse, con retracción:

| Cuentas | Honestos | Retractado en 12 h | Mediana | Percentil 90 |
|---|---|---|---|---|
| 3 | 1 % y 3 % | 100 % | 30 a 35 min | 35 a 40 min |
| 5 | 1 % y 3 % | 100 % | 30 a 35 min | 35 a 90 min |

Resultado igual para N = 2, 3 y 5 y para las tres formas de calcular la proporción. SIN retracción el incidente falso dura 12 h (720 min, cierre por inactividad) si el atacante
no renueva y sin límite si sus cuentas siguen respondiendo "sí". La primera ronda de "¿Ya volvió?" sale a los 30 min, por eso la mediana es de unos 30 min.

**Corte real confirmado de verdad: % retractado por error en 12 h** (error honesto de respuesta del 5 %). "Todos" = proporción sobre todos los votos; "propia" = solo celda propia; "ambas" = las dos deben bajar de 0,4 (valor elegido). N = personas de la celda propia con "no".

| Corte | Adopción | % afectado en la celda | N=2 todos | N=3 todos | N=5 todos | N=3 propia | N=3 ambas |
|---|---|---|---|---|---|---|---|
| 1 celda | 1 % | 100 | 1 | 0 | 0 | 0 | 0 |
| 1 celda | 1 % | 85 | 9 | 6 | 4 | 0 | 0 |
| 1 celda | 1 % | 60 | 64 | 62 | 61 | 5 | 5 |
| 1 celda | 1 % | 40 | 100 | 100 | 96 | 63 | 63 |
| 1 celda | 3 % | 100 / 85 / 60 / 40 | 0 / 2 / 20 / 85 | 0 / 1 / 17 / 85 | 0 / 0 / 13 / 84 | 0 / 0 / 4 / 71 | 0 / 0 / 4 / 71 |
| 7 celdas | 1 % | 100 / 85 / 60 / 40 | 0 / 0 / 1 / 30 | 0 / 0 / 1 / 30 | 0 / 0 / 1 / 30 | 0 / 1 / 25 / 79 | 0 / 0 / 1 / 29 |
| 7 celdas | 3 % | 100 / 85 / 60 / 40 | 0 / 0 / 0 / 15 | 0 / 0 / 0 / 15 | 0 / 0 / 0 / 15 | 0 / 0 / 9 / 79 | 0 / 0 / 0 / 15 |

Con "ambas" (N = 3, proporción < 0,4) un corte real casi nunca se retracta cuando afecta al 85 % o más de la celda (0 %), casi nunca cuando afecta al 60 %
(0 a 5 %), y se retracta cuando solo afecta al 40 % (la mayoría de la celda tiene servicio, lo cual es correcto). Con N = 2 aumentan las retracciones erróneas; con N = 5 casi no mejora.

**Expiración a 60 min contra 45 min (prueba con respuestas lentas, media 25 min, visible a 120 min):** 1 celda 1 %: 27 % en ambos; 1 celda 3 %: 85 % (60 min) contra 84 % (45 min);
7 celdas: 100 % en ambos. Con el caso central (media 5 min) son idénticos en todas las celdas. Efecto prácticamente nulo bajo estos supuestos.

### 8.8 Qué conclusiones de la v1 cambian (contradicciones declaradas)

1. **Las protecciones ya no recuperan los cortes de 1 celda.** La v1 decía que la regla e subía los cortes de 1 celda con 1 % de adopción de 24 % (d) a 53 %. En la v2 final (f) sube solo de 27 % (d) a 29 %, frente a 42 % de la original (a). La mejora de e venía de preguntar primero a la celda propia, que §2.6 no permite como reparto observable. Con preguntas primero a la celda propia (h) la v2 da 46 %; con la mitad (w), 45 %. DECISIÓN APROBADA 26/10/2026: se adopta h (primero la celda propia, relleno obligatorio): visibilidad de cortes de 1 celda 29 % -> 46 % y 3 cuentas falsas publican 54 % -> 16 %. El costo es de privacidad (quien recibe la pregunta puede inferir que hay reportes cerca), mitigado con relleno obligatorio y texto neutro (§2.6, §9 riesgo 9).
2. **La v2 final deja pasar más abuso que la regla e de la v1** con adopción de 1 %: 30 cuentas juntas fabrican 5,4 zonas (v1: 0,9) y 3 cuentas publican el 54 % de las veces (e: 6 %). Las causas son las cuentas del atacante con más de 24 h (la v1 no las distinguía) y el reparto de preguntas al azar. Con h baja a 16 % y 1,7 zonas. La compuerta de adopción (1 %) sigue siendo necesaria: sin ella 30 cuentas dispersas fabrican 11,6 a 11,9 zonas con adopción de 0,1 % a 0,5 %.
3. **La regla de noche aprobada no frena a un atacante**: a las 02:00, 3 cuentas con más de 24 h publican el 100 % de las veces con el modo `or` (§8.3).
4. **La alerta por red de 5 altas por hora no sirve en el pico** (51 % a 90 % de las altas honestas con 1.000 altas por hora y 20 a 100 redes móviles). La v1 solo la había calculado de forma determinista.
5. **La deduplicación por red no es gratis**: con pocas redes móviles (10 a 30) y 90 % de datos móviles, la celda de origen pierde 17 % a 38 % de las personas y un corte de 1 celda se ve 5 a 15 puntos menos. La v1 decía "dentro del ruido" con un modelo que incluía un 10 % de teléfonos verificados exentos.
6. **Expiración a 45 contra 60 min**: sin diferencia medible (§8.7). La v1 la había justificado por coherencia, no por una mejora medida.
7. **Cobertura sin exclusividad**: sube a 98 % a 100 % (la v1 no la medía), pero pinta celdas sin corte (11 celdas en un corte de 7 celdas con 1 %).
8. **Se confirma de la v1**: con 1 o 2 redes el atacante fabrica 0,0 zonas; la espera de 5 min y el ancla son lo que contiene al atacante de 3 cuentas en una celda con ancla propia; los cortes de 7 celdas o más se ven bien con 1 % de adopción.

### 8.9 Limitaciones de la simulación v2
- Densidad uniforme de 5.000 personas por celda; en la realidad el piloto concentrado y fuera de él casi vacío. Todos los números dependen de la adopción.
- Refinamiento res 7 -> res 8, el relleno de preguntas y la curva de peso por antigüedad/trust no están modelados.
- No hay distribución real de redes móviles de Guayaquil, de proveedores ni de horarios de reporte; son supuestos.
- Una zona publicada se evalúa por celda con su propio disco (cada celda es su propio incidente de origen); no se simula el índice único parcial ni la unión de incidentes cercanos.
- Un solo atacante a la vez; no hay atacante que combine acaparar preguntas con cuentas falsas y con "no" masivos.
- La retracción se prueba sobre el origen del incidente; el costo para cortes que cruzan varias celdas con proporciones distintas por celda no se midió celda por celda.
- El cooldown de retracción (`retract_cooldown_h`) no está medido.

## 9. Riesgos abiertos

1. Las medidas aprobadas empeoran los cortes de 1 celda y facilitan el abuso sin las protecciones de §2 regla 3, y el reparto neutro de preguntas debilitaba las protecciones (§8.8, puntos 1 y 2); resuelto el 26/10/2026 con el reparto "celda propia primero" (§2.6).
2. Todos los resultados dependen de la densidad de usuarios. Con adopción < 0,5 % fuera de las ciudadelas piloto, la
   mayoría de los cortes pequeños no se verá en el mapa, y con la compuerta de adopción (1 %) ningún corte se verá por debajo de ese umbral. Hay que medir adopción real en la semana 1 del piloto.
3. Atacante con redes distintas: no hay defensa técnica barata; se mitiga con costos (captcha, cuentas de 24 h, ancla, espera, retracción) y alertas.
4. `net_hash` es un dato pseudonimizado (LOPDP): texto en la política de privacidad, borrado a 7 días con prueba y
   retención en backups/PITR declarada.
5. Modelo de redes (CGNAT) supuesto. Si pocas /24 concentran miles de usuarios móviles, la deduplicación por red
   castigará a gente real (§8.5). Sin OTP no hay exención; el mitigante es medirlo en el piloto y que la alerta no cambie pesos.
6. La espera de 5 min añade latencia al primer aviso (medido: sin efecto visible en los tiempos de §8.2).
7. Sin exclusividad por origen, dos incidentes adyacentes se ven como zonas contiguas y la agrupación a res 7 pinta celdas sin corte (§8.2). Decidir si se acepta o se limita la promoción a res 7.
8. Pendiente: peso por antigüedad de cuenta y trust, no simulados (todos peso 1).
9. Inferencia por la pregunta push: con el reparto aprobado el 26/10/2026 (primero a la celda propia) recibir la pregunta PUEDE revelar que hay reportes cerca.
   Ese costo de privacidad fue ACEPTADO a cambio de visibilidad 29 % -> 46 % en cortes de 1 celda y de bajar 54 % -> 16 % las zonas falsas con 3 cuentas. Se mitiga con
   relleno obligatorio de celdas sin reportes (`incident_ask_filler_pct` > 0, falla cerrado), texto neutro, retraso aleatorio, máximo 1 por `net_hash` y exclusión
   de cuentas < 24 h (§2.6). Riesgo residual: zonas con muy pocos suscritos. REQUISITO del piloto: medir (a) qué fracción de preguntas de relleno se responde, y
   (b) si el relleno realmente impide inferir reportes (por ejemplo, si responder "sí" a un relleno sigue correlacionando con reportes cercanos); si no lo impide,
   volver a decidir con el usuario.
10. Sin la regla de adopción mínima, el atacante disperso fabrica zonas falsas fuera del piloto (§2 regla 7, §8.4). Con la regla, durante la primera semana tras el lanzamiento (solo cuentan cuentas de más de 7 días) no se publica nada (§11, punto 6).
11. Latencia del job de pg_cron (10 a 15 s) como techo del tiempo de reacción del motor; aceptable frente al cubo de 5 min.
12. Noche: el modo `or` no frenaba a un atacante (§8.3); con `and` (valor inicial) frena a 3 cuentas pero NO a 5, y de noche tampoco hay contradicción de vecinos ni rondas. Mitigación: revisión de las 06:30 (§2 regla 8).
13. Negación de servicio por "no": con 200 cuentas de más de 24 h suscritas en una celda un atacante puede esconder un corte real más de la mitad de las veces (§8.4a). Sin mitigación aprobada.
14. Ciclo de retracción: tras retractar, el atacante puede volver a fabricar el incidente. Ahora el cooldown no bloquea votos nuevos y la republicación exige "sí" posteriores de personas que no votaron en el retractado (§2 regla 9); su valor y efecto no están medidos.
15. Internet por proveedor: el modelo de datos no guarda el proveedor por usuario ni por lugar suscrito, así que no se puede dirigir la pregunta; con la adopción repartida, internet casi no se ve en el piloto (§8.6).
16. CLAUDE.md §12 limita las altas de sesión anónima a 60 por hora por IP: en un pico muy fuerte con datos móviles (CGNAT) esto bloquea a usuarios honestos (§8.5).
17. NUEVO: atacante que retracta un corte real. 5 cuentas de más de 24 h, con lugar de más de 24 h en la celda, en redes distintas, responden "no" (o "ya tengo servicio") y retractan
    un corte genuino (3 personas y proporción < 0,4 se cumplen si los honestos son pocos: con adopción de 1 % el propio corte real tiene pocos "sí"). Es el espejo de fabricar una zona
    falsa y no se simuló (la simulación de §8.7 solo cubre error honesto y atacante que publica). No se fijan N = 3 ni 0,4 definitivamente hasta simularlo (§13.1).
18. NUEVO: la compuerta de adopción cuesta ~315 cuentas de más de 7 días con push activo (con honestos al 0,1 %); es un freno de oleadas, no una defensa fuerte (§2 regla 7).
19. NUEVO: el umbral de cuentas de más de 24 h es un freno de oleadas, no de atacantes pacientes; efecto colateral: quien se instala durante el apagón no cuenta el primer día (§2.5).

## 10. Estado de CLAUDE.md

CLAUDE.md lo edita el usuario. El usuario va a alinear en CLAUDE.md los puntos ya acordados (IPv6 solo /56, solo la forma HKDF, rotación con ventana 03:30-04:30,
alerta de red sin peso cero, horario silencioso con excepción luz/agua hasta 23:00, ancla definida como en esta spec, retracción con >=3 personas y 0,4, compuerta de
adopción por res 7 con arranque sin mapa los primeros 7 días, regla de supresión y backups en §10). Lo que CLAUDE.md AÚN NO trae y esta spec sí, para alinear:
- §7: `expire_suspected_minutes` = 60 (era 45); resolución con >=3 personas y proporción >=0,6 (no "≥50 % o reportes back"; un solo `back` nunca cierra); noche con 5 personas Y 2 anclas,
  revisión de las 06:30 y rondas suspendidas de noche (primera ronda a las 06:00); tope de visibilidad con renovación de >=2 personas y techo absoluto de 48 h (luz y agua);
  "¿Ya volvió?" también a suscritos que no votaron; retracción solo con cuentas y lugares de más de 24 h y cooldown que no bloquea votos nuevos; protección (d) como regla de reparto aprobada (celda propia primero, con relleno obligatorio);
  `published_zones` y canal Broadcast del job (no `postgres_changes`); regla de resolución de zona (res 8 con >=3 en el disco; refinamiento a >=5 y 10 min); exención por teléfono desactivada.
- §6: tablas `anon_signups`, `published_zones`/`incidents` privada, `h3_neighbors`, `h3_parent`, tabla de votos con `person_key` aleatorio; contadores materializados en el incidente; `config` con las claves de §5.
- §8: texto neutro de la pregunta push sin sector, con retraso aleatorio y relleno obligatorio (`incident_ask_filler_pct` > 0); muestreo con máximo 1 destinatario por `net_hash`;
  a las 22:30 solo luz y agua; el cupo de 3 al día y si "¿Ya volvió?" cuenta (§11).
- §10: k sobre el disco ("3 personas en un radio de ~2 km"); `net_hash` como pseudonimización sin pasar a la tabla de votos; eliminar `confirmations` y `reports` del usuario sin mover resultados.
- §12: HMAC en las claves de rate limit; revisar el límite de 60 altas por hora por IP frente al CGNAT; compuerta de adopción con push activo, sin vía de voto coincidente, con alerta y congelamiento.
- §14: el throttle de 5 s no sustituye al cubo de 5 min de privacidad.

## 11. Pendiente (solo lo que sigue abierto)

APROBADAS el 26/10/2026 y ya movidas a reglas normales (§2 reglas 8 a 10, §3.1, §5): (1) horario nocturno (publicación endurecida a `and`, §2 regla 8) y preguntas de luz y agua hasta las 23:00; (2) retracción tras confirmar, con tope duro de visibilidad; (3) OTP de teléfono después del lanzamiento (la exención sigue desactivada); (4) `expire_suspected_minutes` = 60.

Sigue abierto, de la decisión original:
A. **Relleno de preguntas (`incident_ask_filler_pct`, obligatorio y > 0; solo falta el valor) y niveles pocos / varios / muchos** (`display_level_few_max`, `display_level_several_max`): valores a fijar con el piloto.

Propuestas que salen de la simulación v2 (las que no dicen RESUELTO no están aprobadas; ninguna cambia lo bloqueado k = 3 y ratio 0,6):
1. (Reparto de preguntas: RESUELTO 26/10/2026, ya es regla en §2.6 y §5; ya no es propuesta.)
2. **Regla de noche.** RESUELTA por endurecimiento: `and` como valor inicial + revisión de las 06:30 (§2 regla 8). Sigue abierto si más adelante conviene no publicar de noche cortes de 1 celda.
3. **Negación por "no".** El muestreo con máximo 1 destinatario por red ya es regla (§2.6). Sigue abierto: que el "no" de cuentas de menos de 7 días pese 0,5 y límites de suscripciones por red y celda.
4. **Alerta por red.** Cambiar el umbral fijo de 5 altas por hora por uno relativo al nivel normal (por ejemplo, mucho más que la mediana de los últimos 7 días) y combinarlo con "votan juntas el mismo incidente".
5. **Agrupación a res 7.** Decidir si se acepta pintar unas 11 celdas sin corte en un corte de 7 celdas, o si solo se promueve a res 7 cuando la celda de origen no cumple su propia regla de res 8.
6. **Arranque del piloto.** Aceptado: la primera semana sin mapa publicado (CLAUDE.md se alinea). Las otras opciones (sembrar, bajar la edad) siguen descartadas por riesgo de abuso.
9. **Techo absoluto de agua e internet.** 48 h se fija para luz y agua; internet y agua por proveedor pueden necesitar otro valor. Definir con el piloto.
7. **Cupo de preguntas.** Confirmar si "¿Ya volvió?" cuenta dentro del máximo de 3 preguntas por día.
8. **Proveedor de internet.** Decidir dónde se guarda el proveedor del usuario para poder dirigir la pregunta (hoy no existe en `user_places`/`profiles`).

## 12. Endurecimientos NUEVOS de la revisión de seguridad (para que el usuario los vea)

El usuario delegó las decisiones de seguridad endurecedoras; se aplicaron como reglas. Lo que NO cambia: k=3, ratio 0,6, vecinas k=1, ventana 60 min, res 8/res 7, sospechado interno, las cuatro protecciones, defensa por red, mínimo de adopción ~1 %, noche, retracción, OTP después del lanzamiento, expiración de sospechado a 60 min.
1. Resolución simétrica: >=3 personas (dedup por red, cuentas >24 h) y proporción >=0,6; un solo `back` nunca cierra; "todavía sin luz" cuenta como "no" y renueva (§2 regla 11).
2. Retracción: solo cuentan cuentas y lugares de más de 24 h, dedup por red, ponderadas por trust; el cooldown ya no bloquea votos nuevos, solo exige "sí" posteriores de personas que no votaron en el retractado (§2 regla 9).
3. Compuerta de adopción: sin la vía circular de "voto coincidente", una vez por cuenta (lugar más antiguo), solo cuentas con push activo (<=30 días) y de más de 7 días, alerta y congelamiento ante saltos (§2 regla 7).
4. `person_key` aleatorio por incidente: el `net_hash` no sale del ciclo de 7 días (§2, §6.3, §7.1).
5. Contadores materializados: la supresión de cuentas nunca retracta, resuelve ni oculta (§4.4).
6. Noche: modo `and` como valor inicial, rondas suspendidas, primera ronda a las 06:00 y expiración automática a las 06:30 sin respaldo independiente (§2 regla 8).
7. Renovación del tope solo con >=2 personas de redes distintas y techo absoluto de 48 h (luz y agua) (§2 regla 10).
8. Preguntas: máximo 1 destinatario por `net_hash`; `incident_ask_filler_pct` bloqueada con mínimo > 0 (§2.6).
9. Límites reconocidos por escrito: las cuentas de más de 24 h son freno de oleadas, y quien se instala en el apagón no cuenta el primer día (§2.5).
10. Realtime = Broadcast del job, nunca `postgres_changes` (§4.2).
11. Reparto de preguntas (decisión APROBADA 26/10/2026, §2.6): primero la celda propia `c`, luego el resto de `U(c)`, con relleno obligatorio (`incident_ask_filler_pct` > 0, falla cerrado), texto neutro, retraso de 0 a 2 min, máximo 1 por `net_hash` y exclusión de cuentas de menos de 24 h. Costo de privacidad aceptado; medir en el piloto (§9, riesgo 9).

## 13. REQUISITOS PREVIOS A IMPLEMENTAR

Nada de esto se ha ejecutado (la simulación completa tarda ~12 min y no se rehízo para esta revisión). No implementar la parte afectada antes de cerrarlos.

13.1 Simular el ataque de retracción antes de fijar N = 3 y 0,4. Escenario: corte real confirmado; 5 cuentas de más de 24 h, con lugar suscrito de más de 24 h en la celda, en 5 redes distintas, responden "no" a las rondas de "¿Ya volvió?". Medir con adopción 0,5 %, 1 % y 3 % y cortes de 1 y 7 celdas: % de cortes reales retractados, tiempo hasta ocultarse y efecto de las dos proporciones, y del cooldown con votos nuevos permitidos. Probar también N = 2, 3, 5 y 0,3 / 0,4 / 0,5. Hasta entonces `retract_min_no_persons` y `retract_ratio` son PROVISIONALES.
13.2 Simular la resolución simétrica (>=3 personas, 0,6): cuánto tardan en cerrarse cortes reales con respuesta baja, y ataque de cierre falso (5 cuentas diciendo "ya volvió"). Mismo script, escenario nuevo.
13.3 Simular la compuerta de adopción endurecida (push activo, sin voto coincidente, una vez por cuenta) y el umbral `adoption_surge_factor`: fijar N con honestos reales del piloto.
13.4 Simular la noche con `and`, la revisión de las 06:30 y la primera ronda a las 06:00: visibilidad de cortes reales nocturnos y zonas falsas de 5 cuentas.
13.5 Simular el muestreo con máximo 1 por red y cupo de `net_hash` NULL, y el relleno obligatorio: efecto en visibilidad de cortes de 1 celda y en acaparar preguntas (§8.4a), y fijar `incident_ask_null_net_max` e `incident_ask_filler_pct`.
13.6 Simular renovación con >=2 personas y techo de 48 h: cortes reales largos que quedan sin renovar por poca adopción.
