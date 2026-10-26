import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/api";
import { getRealDeps } from "@/lib/server/deps";
import { createReportsHandler } from "@/lib/server/reports-handler";

// POST /api/v1/reports: crea un reporte. Validación Zod, límites de frecuencia y sesión anónima.
export async function POST(request: NextRequest) {
  let deps;
  try {
    deps = getRealDeps();
  } catch {
    // Configuración incompleta en el despliegue: no se expone nada interno.
    return errorResponse(503, "SERVICE_UNAVAILABLE", "Servicio no disponible por un momento.", crypto.randomUUID());
  }
  return createReportsHandler(deps)(request);
}
