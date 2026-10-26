import { REPORTS_ENDPOINT, type ReportPayload } from "@/lib/report-types";

export type SendResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; code: string; retryAfter?: number };

// Envía un reporte. Nunca lanza: devuelve un código que la interfaz traduce a un mensaje claro.
export async function sendReport(payload: ReportPayload): Promise<SendResult> {
  try {
    const response = await fetch(REPORTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { data?: { status?: string } } | null;
      return { ok: true, duplicate: body?.data?.status === "duplicate" };
    }
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    const retry = Number(response.headers.get("retry-after"));
    return {
      ok: false,
      code: body?.error?.code ?? "INTERNAL",
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}
