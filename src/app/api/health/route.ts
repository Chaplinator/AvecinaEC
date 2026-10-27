import { getHealthDeps } from "@/lib/server/health-deps";
import { createHealthHandler } from "@/lib/server/health";

// Healthcheck para el monitor de uptime: verifica la base de datos y Redis (CLAUDE.md §15).
// Responde 200 {"status":"ok"} o 503 {"status":"degraded"}, sin detalles internos.
let handler: (() => Promise<Response>) | null = null;

export async function GET(): Promise<Response> {
  try {
    handler ??= createHealthHandler(getHealthDeps());
  } catch {
    // Configuración incompleta o inválida: el servicio no está sano, y no se expone por qué.
    console.error(JSON.stringify({ level: "error", event: "health_degraded", component: "config" }));
    return Response.json({ status: "degraded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return handler();
}
