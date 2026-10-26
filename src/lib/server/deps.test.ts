import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks de los módulos externos: aquí solo se prueba la decisión de cuándo pedir captcha y crear sesión.
const auth = vi.hoisted(() => ({
  getClaims: vi.fn(),
  refreshSession: vi.fn(),
  signInAnonymously: vi.fn(),
}));
const sessionLimit = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth, from: vi.fn() }),
}));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = () => ({});
    constructor(public options: { prefix: string }) {}
    limit(key: string) {
      return this.options.prefix === "rl:session:ip"
        ? sessionLimit(key)
        : Promise.resolve({ success: true, reset: Date.now() + 1000 });
    }
  }
  return { Ratelimit };
});
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/server/env", () => ({
  serverEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummydummydummy",
    SUPABASE_SERVICE_ROLE_KEY: "dummydummydummydummydummy",
    UPSTASH_REDIS_REST_URL: "https://dummy.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "dummytokendummy",
  }),
}));

import { ACCESS_COOKIE, REFRESH_COOKIE, getRealDeps } from "@/lib/server/deps";
import { CaptchaRequiredError, RateLimitedError, ServiceUnavailableError } from "@/lib/server/reports-handler";

const USER = "11111111-1111-4111-8111-111111111111";
const session = { access_token: "a", refresh_token: "r", expires_in: 3600 };

function requestWith(cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest("https://app.test/api/v1/reports", { method: "POST", headers: cookie ? { cookie } : {} });
}

describe("ensureSession (captcha en el alta anónima)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getClaims.mockResolvedValue({ data: null, error: new Error("sin sesión") });
    auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: new Error("sin sesión") });
    auth.signInAnonymously.mockResolvedValue({ data: { session, user: { id: USER } }, error: null });
    sessionLimit.mockResolvedValue({ success: true, reset: Date.now() + 1000 });
  });

  it("con cookie de acceso válida no pide captcha ni crea nada", async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const result = await getRealDeps().ensureSession(requestWith({ [ACCESS_COOKIE]: "jwt" }), "ip", null);
    expect(result).toEqual({ userId: USER, tokens: null });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("con cookie de refresco válida renueva la sesión sin captcha", async () => {
    auth.refreshSession.mockResolvedValue({ data: { session, user: { id: USER } }, error: null });
    const result = await getRealDeps().ensureSession(requestWith({ [REFRESH_COOKIE]: "rt" }), "ip", null);
    expect(result.userId).toBe(USER);
    expect(result.tokens).not.toBeNull();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("sin sesión y sin token pide captcha antes de tocar Redis o Supabase", async () => {
    await expect(getRealDeps().ensureSession(requestWith(), "ip", null)).rejects.toBeInstanceOf(CaptchaRequiredError);
    expect(sessionLimit).not.toHaveBeenCalled();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("con token pero la IP ya creó demasiadas sesiones responde 429 sin llamar a Supabase", async () => {
    sessionLimit.mockResolvedValue({ success: false, reset: Date.now() + 60_000 });
    await expect(getRealDeps().ensureSession(requestWith(), "ip", "tok")).rejects.toBeInstanceOf(RateLimitedError);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("con token crea la sesión y se lo pasa a Supabase", async () => {
    const result = await getRealDeps().ensureSession(requestWith(), "ip", "tok");
    expect(result.userId).toBe(USER);
    expect(result.tokens).toEqual({ accessToken: "a", refreshToken: "r", expiresIn: 3600 });
    expect(auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: "tok" } });
  });

  it("si Supabase rechaza el captcha, pide uno nuevo", async () => {
    auth.signInAnonymously.mockResolvedValue({ data: { session: null, user: null }, error: { code: "captcha_failed" } });
    await expect(getRealDeps().ensureSession(requestWith(), "ip", "tok")).rejects.toBeInstanceOf(CaptchaRequiredError);
  });

  it("si Supabase falla por otra causa responde 503", async () => {
    auth.signInAnonymously.mockResolvedValue({ data: { session: null, user: null }, error: { code: "unexpected_failure" } });
    await expect(getRealDeps().ensureSession(requestWith(), "ip", "tok")).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
