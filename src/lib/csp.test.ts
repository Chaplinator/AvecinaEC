import { describe, expect, it } from "vitest";
import { buildCsp, captchaOrigins, connectOrigins, generateNonce } from "./csp";

describe("csp", () => {
  it("genera un nonce distinto en cada llamada", () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });

  it("incluye el nonce y bloquea framing y objetos", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("solo permite unsafe-eval en desarrollo", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
    expect(buildCsp("n", false)).not.toContain("'unsafe-eval'");
  });

  it("sin orígenes externos, connect-src es solo 'self'", () => {
    expect(buildCsp("n", false)).toContain("connect-src 'self';");
  });

  it("deriva orígenes explícitos de Sentry y Supabase", () => {
    const origins = connectOrigins({
      NEXT_PUBLIC_SENTRY_DSN: "https://pub@o1.ingest.sentry.io/123",
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    });
    expect(origins).toEqual([
      "https://o1.ingest.sentry.io",
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
    ]);
    expect(buildCsp("n", false, origins)).not.toContain("*");
  });

  it("sin captcha configurado, no se permite ningún marco", () => {
    expect(captchaOrigins({})).toEqual([]);
    expect(buildCsp("n", false)).toContain("frame-src 'none'");
  });

  it("con la llave de Turnstile, permite solo el origen de Cloudflare en marcos y conexiones", () => {
    const captcha = captchaOrigins({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0xAAA" });
    expect(captcha).toEqual(["https://challenges.cloudflare.com"]);
    const csp = buildCsp("n", false, captcha, captcha);
    expect(csp).toContain("frame-src https://challenges.cloudflare.com;");
    expect(csp).toContain("connect-src 'self' https://challenges.cloudflare.com;");
    expect(csp).not.toContain("*");
  });

  it("rechaza esquemas que no son https (salvo http en localhost)", () => {
    expect(connectOrigins({ NEXT_PUBLIC_SENTRY_DSN: "javascript:alert(1)" })).toEqual([]);
    expect(connectOrigins({ NEXT_PUBLIC_SENTRY_DSN: "http://pub@evil.test/1" })).toEqual([]);
    expect(connectOrigins({ NEXT_PUBLIC_SENTRY_DSN: "http://pub@localhost:9999/1" })).toEqual([
      "http://localhost:9999",
    ]);
  });

  it("ignora valores inválidos", () => {
    expect(connectOrigins({ NEXT_PUBLIC_SENTRY_DSN: "no-es-url" })).toEqual([]);
  });
});
