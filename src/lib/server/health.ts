// Chequeo de salud para el monitor de uptime: verifica de verdad la base de datos y Redis.
// Solo responde "ok" o "degraded", sin detalles internos (CLAUDE.md §9).
// El resultado se guarda unos segundos para que un monitor frecuente (o alguien martillando la URL)
// no se convierta en carga para la base ni para Redis.
export type HealthDeps = {
  checkDb(): Promise<void>;
  checkRedis(): Promise<void>;
  // Solo el nombre del componente que falló: sin datos personales ni mensajes de error.
  log(component: "db" | "redis" | "config"): void;
};

export const HEALTH_CACHE_MS = 10_000;
export const HEALTH_TIMEOUT_MS = 3_000;

type Verdict = { ok: boolean; at: number };

function withTimeout(operation: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

export function createHealthHandler(
  deps: HealthDeps,
  options: { now?: () => number; timeoutMs?: number } = {},
) {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  let last: Verdict | null = null;
  let inFlight: Promise<Verdict> | null = null;

  async function evaluate(): Promise<Verdict> {
    const [db, redis] = await Promise.allSettled([
      withTimeout(deps.checkDb(), timeoutMs),
      withTimeout(deps.checkRedis(), timeoutMs),
    ]);
    if (db.status === "rejected") deps.log("db");
    if (redis.status === "rejected") deps.log("redis");
    return { ok: db.status === "fulfilled" && redis.status === "fulfilled", at: now() };
  }

  return async function GET(): Promise<Response> {
    if (!last || now() - last.at >= HEALTH_CACHE_MS) {
      // Varias solicitudes simultáneas comparten una sola comprobación.
      inFlight ??= evaluate().finally(() => {
        inFlight = null;
      });
      last = await inFlight;
    }
    return Response.json(
      { status: last.ok ? "ok" : "degraded" },
      {
        status: last.ok ? 200 : 503,
        // El CDN puede servirlo unos segundos; nunca se guarda en el navegador.
        headers: { "Cache-Control": "public, max-age=0, s-maxage=10" },
      },
    );
  };
}
