import { describe, expect, it } from "vitest";
import { clientKey, isJsonRequest, isSameOrigin } from "@/lib/server/api";
import { serverEnv } from "@/lib/server/env";

const req = (headers: Record<string, string>) => new Request("https://app.test/api/v1/reports", { method: "POST", headers });

describe("api helpers", () => {
  it("isSameOrigin exige un Origin igual al de la app", () => {
    expect(isSameOrigin(req({ origin: "https://app.test" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://otro.test" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "http://app.test" }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(false);
    expect(isSameOrigin(req({ origin: "no-es-url" }))).toBe(false);
  });

  it("isJsonRequest reconoce application/json con parámetros", () => {
    expect(isJsonRequest(req({ "content-type": "application/json; charset=utf-8" }))).toBe(true);
    expect(isJsonRequest(req({ "content-type": "text/plain" }))).toBe(false);
    expect(isJsonRequest(req({}))).toBe(false);
  });

  it("clientKey es estable, no revela la IP y depende del secreto", () => {
    const a = clientKey(req({ "x-forwarded-for": "190.15.1.2, 10.0.0.1" }), "secreto");
    const b = clientKey(req({ "x-forwarded-for": "190.15.1.2" }), "secreto");
    const c = clientKey(req({ "x-forwarded-for": "190.15.1.3" }), "secreto");
    const d = clientKey(req({ "x-forwarded-for": "190.15.1.2" }), "otro-secreto");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).not.toContain("190");
    expect(a).toHaveLength(32);
  });
});

describe("serverEnv", () => {
  const ok = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxx",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_xxxxxxxxxxxxxxxxxxxx",
    UPSTASH_REDIS_REST_URL: "https://wise.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "token-de-prueba-123",
  };

  it("acepta una configuración completa", () => {
    expect(serverEnv(ok).UPSTASH_REDIS_REST_URL).toBe("https://wise.upstash.io");
  });

  it("nombra las variables que faltan pero nunca sus valores", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _quitada, ...incompleta } = ok;
    void _quitada;
    expect(() => serverEnv(incompleta)).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
    try {
      serverEnv({ ...incompleta, UPSTASH_REDIS_REST_TOKEN: "corto" });
    } catch (error) {
      expect(String(error)).not.toContain("corto");
      expect(String(error)).not.toContain("sb_publishable");
    }
  });

  it("rechaza una URL de Upstash con comillas (error típico al copiar)", () => {
    expect(() => serverEnv({ ...ok, UPSTASH_REDIS_REST_URL: '"https://wise.upstash.io"' })).toThrowError(
      /UPSTASH_REDIS_REST_URL/,
    );
  });
});
