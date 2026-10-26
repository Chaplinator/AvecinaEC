import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import type { NextRequest, NextResponse } from "next/server";
import { clientKey } from "@/lib/server/api";
import { serverEnv } from "@/lib/server/env";
import {
  ServiceUnavailableError,
  SLOT_SECONDS,
  type Deps,
  type LimitResult,
  type ReportRow,
  type SessionTokens,
} from "@/lib/server/reports-handler";

export const ACCESS_COOKIE = "sefue_at";
export const REFRESH_COOKIE = "sefue_rt";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 60; // 60 días

let cached: Deps | null = null;

// Cualquier fallo de Redis cierra la puerta (503) en lugar de dejar pasar sin límite: es la defensa antiabuso.
async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ServiceUnavailableError("Redis no disponible");
  }
}

export function getRealDeps(): Deps {
  if (cached) return cached;
  const env = serverEnv();
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

  // CLAUDE.md §12: 10 reportes por hora por usuario; además un tope por IP.
  const ipLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(40, "1 h"),
    prefix: "rl:reports:ip",
    analytics: false,
  });
  const userLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 h"),
    prefix: "rl:reports:user",
    analytics: false,
  });
  const toResult = (r: { success: boolean; reset: number }): LimitResult => ({
    ok: r.success,
    retryAfter: Math.ceil((r.reset - Date.now()) / 1000),
  });

  const authClient = () =>
    createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  const adminClient = () =>
    createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  const tokensOf = (session: { access_token: string; refresh_token: string; expires_in: number }): SessionTokens => ({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
  });

  cached = {
    clientKey: (request) => clientKey(request, env.UPSTASH_REDIS_REST_TOKEN),
    limitIp: (key) => guard(async () => toResult(await ipLimiter.limit(key))),
    limitUser: (userId) => guard(async () => toResult(await userLimiter.limit(userId))),

    async ensureSession(request: NextRequest) {
      const client = authClient();
      const access = request.cookies.get(ACCESS_COOKIE)?.value;
      if (access) {
        const { data, error } = await client.auth.getClaims(access);
        const sub = data?.claims?.sub;
        if (!error && typeof sub === "string") return { userId: sub, tokens: null };
      }
      const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
      if (refresh) {
        const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
        if (!error && data.session && data.user) return { userId: data.user.id, tokens: tokensOf(data.session) };
      }
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.session || !data.user) throw new Error("No se pudo crear la sesión anónima");
      return { userId: data.user.id, tokens: tokensOf(data.session) };
    },

    seenRequest: (userId, clientRequestId) =>
      guard(async () => (await redis.exists(`rpt:idem:${userId}:${clientRequestId}`)) === 1),
    markRequest: (userId, clientRequestId) =>
      guard(async () => {
        await redis.set(`rpt:idem:${userId}:${clientRequestId}`, "1", { ex: 60 * 60 * 24 });
      }),
    claimSlot: (userId, type, cell) =>
      guard(async () => (await redis.set(`rpt:slot:${userId}:${type}:${cell}`, "1", { nx: true, ex: SLOT_SECONDS })) === "OK"),
    releaseSlot: (userId, type, cell) =>
      guard(async () => {
        await redis.del(`rpt:slot:${userId}:${type}:${cell}`);
      }),

    async insertReport(row: ReportRow) {
      const { error } = await adminClient().from("reports").insert(row);
      if (!error) return "created";
      if (error.code === "23505") return "duplicate"; // (user_id, client_request_id) ya existe
      throw new Error(`Error al guardar el reporte (${error.code ?? "sin código"})`);
    },

    applySession(response: NextResponse, tokens: SessionTokens) {
      const base = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/api" };
      response.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: Math.max(60, tokens.expiresIn) });
      response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE });
    },

    logError(requestId, error) {
      // Sin datos personales: solo el identificador de la solicitud y el tipo de error.
      console.error(
        JSON.stringify({ level: "error", requestId, error: error instanceof Error ? error.name : "desconocido" }),
      );
      if (!(error instanceof ServiceUnavailableError)) Sentry.captureException(error, { tags: { requestId } });
    },
  };
  return cached;
}
