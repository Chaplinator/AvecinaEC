import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

// Formato de error uniforme (CLAUDE.md §11): { error: { code, message, requestId } }
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  extra?: { retryAfter?: number; fields?: string[] },
): NextResponse {
  const headers: Record<string, string> = {
    "x-request-id": requestId,
    "Cache-Control": "no-store",
  };
  if (extra?.retryAfter !== undefined) headers["Retry-After"] = String(Math.max(1, extra.retryAfter));
  const body: { error: Record<string, unknown> } = { error: { code, message, requestId } };
  if (extra?.fields) body.error.fields = extra.fields;
  return NextResponse.json(body, { status, headers });
}

export function jsonResponse(status: number, data: unknown, requestId: string): NextResponse {
  return NextResponse.json({ data }, { status, headers: { "x-request-id": requestId, "Cache-Control": "no-store" } });
}

// Protección CSRF para escrituras: si el navegador manda Origin, debe ser el de la propia app.
// Sin Origin no se acepta (los navegadores lo envían siempre en POST de otro sitio).
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isJsonRequest(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

// La IP nunca se guarda en claro: se convierte en un código irreversible (HMAC) con un secreto del servidor.
export function clientKey(request: Request, secret: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("x-real-ip") ?? forwarded ?? "desconocida";
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}
