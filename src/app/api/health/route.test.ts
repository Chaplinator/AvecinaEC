import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/health (ruta)", () => {
  it("sin configuración responde 503 degraded, sin detalles y sin cachear", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
