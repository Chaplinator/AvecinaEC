import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

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
});
