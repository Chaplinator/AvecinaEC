// Healthcheck liviano para el monitor de uptime.
// TODO (Día 2+): verificar BD y Redis cuando existan.
export async function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
