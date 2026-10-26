import type { NextRequest, NextResponse } from "next/server";
import { errorResponse, isJsonRequest, isSameOrigin, jsonResponse } from "@/lib/server/api";
import { reportSchema } from "@/lib/server/reports-schema";
import type { ReportInput } from "@/lib/server/reports-schema";

export type SessionTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export type LimitResult = { ok: boolean; retryAfter: number };

export type ReportRow = {
  user_id: string;
  type: ReportInput["type"];
  status_value: ReportInput["status_value"];
  h3_cell: string;
  provider: string | null;
  source: "manual";
  client_request_id: string;
};

// Todo lo que toca el mundo exterior entra por aquí: así el manejador se prueba sin Redis ni Supabase.
export type Deps = {
  clientKey(request: Request): string;
  limitIp(key: string): Promise<LimitResult>;
  limitUser(userId: string): Promise<LimitResult>;
  // Crea una sesión anónima solo si hace falta; si la IP ya creó demasiadas, lanza RateLimitedError.
  // Sin sesión válida, crear una nueva exige un token de captcha: sin él lanza CaptchaRequiredError.
  ensureSession(
    request: NextRequest,
    ipKey: string,
    captchaToken: string | null,
  ): Promise<{ userId: string; tokens: SessionTokens | null }>;
  seenRequest(userId: string, clientRequestId: string): Promise<boolean>;
  markRequest(userId: string, clientRequestId: string): Promise<void>;
  claimSlot(userId: string, type: string, cell: string): Promise<boolean>;
  releaseSlot(userId: string, type: string, cell: string): Promise<void>;
  insertReport(row: ReportRow): Promise<"created" | "duplicate">;
  applySession(response: NextResponse, tokens: SessionTokens): void;
  logError(requestId: string, error: unknown): void;
};

export class ServiceUnavailableError extends Error {}

// Hace falta (o falló) la verificación de captcha para crear la sesión anónima.
export class CaptchaRequiredError extends Error {}

export const CAPTCHA_HEADER = "x-captcha-token";
// Los tokens de Turnstile miden hasta 2048 caracteres; solo caracteres seguros para una cabecera.
const CAPTCHA_TOKEN = /^[A-Za-z0-9._-]{1,2048}$/;

function captchaTokenOf(request: Request): string | null {
  const value = request.headers.get(CAPTCHA_HEADER);
  return value && CAPTCHA_TOKEN.test(value) ? value : null;
}

export class RateLimitedError extends Error {
  constructor(public retryAfter: number) {
    super("Límite de frecuencia");
  }
}

export const MAX_BODY_BYTES = 2048;
// Un reporte por tipo y celda cada 10 minutos (CLAUDE.md §12).
export const SLOT_SECONDS = 600;

export function createReportsHandler(deps: Deps) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const requestId = crypto.randomUUID();
    try {
      if (!isSameOrigin(request)) {
        return errorResponse(403, "FORBIDDEN", "Solicitud no permitida.", requestId);
      }
      if (!isJsonRequest(request)) {
        return errorResponse(400, "BAD_REQUEST", "El formato de la solicitud no es válido.", requestId);
      }
      // Si el cliente declara un cuerpo enorme, se corta antes de leerlo.
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > MAX_BODY_BYTES) {
        return errorResponse(413, "PAYLOAD_TOO_LARGE", "La solicitud es demasiado grande.", requestId);
      }

      // 1. Límite por IP, antes de leer el cuerpo y de tocar nada costoso (sesiones, base de datos).
      const ipKey = deps.clientKey(request);
      const ip = await deps.limitIp(ipKey);
      if (!ip.ok) {
        return errorResponse(429, "RATE_LIMITED", "Demasiadas solicitudes. Intenta más tarde.", requestId, {
          retryAfter: ip.retryAfter,
        });
      }

      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
        return errorResponse(413, "PAYLOAD_TOO_LARGE", "La solicitud es demasiado grande.", requestId);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return errorResponse(400, "BAD_REQUEST", "El formato de la solicitud no es válido.", requestId);
      }

      // 2. Validación estricta.
      const parsed = reportSchema.safeParse(raw);
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "body"))];
        return errorResponse(422, "VALIDATION_ERROR", "Los datos del reporte no son válidos.", requestId, { fields });
      }
      const input = parsed.data;

      // 3. Sesión anónima (se crea sola en el primer reporte: no hay registro).
      const { userId, tokens } = await deps.ensureSession(request, ipKey, captchaTokenOf(request));
      const done = (status: number, outcome: "created" | "duplicate") => {
        const response = jsonResponse(status, { status: outcome }, requestId);
        if (tokens) deps.applySession(response, tokens);
        return response;
      };

      // 4. Idempotencia y límite por usuario en paralelo (un solo viaje de espera a Redis).
      const [seen, user] = await Promise.all([
        deps.seenRequest(userId, input.client_request_id),
        deps.limitUser(userId),
      ]);
      if (seen) return done(200, "duplicate");
      if (!user.ok) {
        return errorResponse(429, "RATE_LIMITED", "Hiciste muchos reportes seguidos.", requestId, {
          retryAfter: user.retryAfter,
        });
      }

      // 5. Un reporte por tipo y celda cada 10 minutos.
      const claimed = await deps.claimSlot(userId, input.type, input.h3_cell);
      if (!claimed) {
        return errorResponse(429, "RATE_LIMITED", "Ya reportaste esto en tu zona hace poco.", requestId, {
          retryAfter: SLOT_SECONDS,
        });
      }

      // 6. Guardado. Si falla, se libera el cupo para que el reintento sea posible.
      let outcome: "created" | "duplicate";
      try {
        outcome = await deps.insertReport({
          user_id: userId,
          type: input.type,
          status_value: input.status_value,
          h3_cell: input.h3_cell,
          provider: input.provider ?? null,
          source: "manual",
          client_request_id: input.client_request_id,
        });
      } catch (error) {
        await deps.releaseSlot(userId, input.type, input.h3_cell).catch(() => undefined);
        throw error;
      }
      await deps.markRequest(userId, input.client_request_id).catch(() => undefined);
      return done(outcome === "created" ? 201 : 200, outcome);
    } catch (error) {
      if (error instanceof RateLimitedError) {
        return errorResponse(429, "RATE_LIMITED", "Demasiadas solicitudes. Intenta más tarde.", requestId, {
          retryAfter: error.retryAfter,
        });
      }
      if (error instanceof CaptchaRequiredError) {
        return errorResponse(403, "CAPTCHA_REQUIRED", "Hace falta verificar que eres una persona.", requestId);
      }
      deps.logError(requestId, error);
      if (error instanceof ServiceUnavailableError) {
        return errorResponse(503, "SERVICE_UNAVAILABLE", "Servicio no disponible por un momento.", requestId, {
          retryAfter: 30,
        });
      }
      return errorResponse(500, "INTERNAL", "Ocurrió un error. Intenta de nuevo.", requestId);
    }
  };
}
