import { describe, expect, it, vi } from "vitest";
import { HEALTH_CACHE_MS, createHealthHandler, type HealthDeps } from "@/lib/server/health";

function makeDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    checkDb: vi.fn(async () => undefined),
    checkRedis: vi.fn(async () => undefined),
    log: vi.fn(),
    ...overrides,
  };
}

describe("GET /api/health", () => {
  it("200 ok cuando la base y Redis responden", async () => {
    const deps = makeDeps();
    const res = await createHealthHandler(deps)();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("503 degraded si falla la base, y solo registra el componente", async () => {
    const deps = makeDeps({ checkDb: vi.fn(async () => Promise.reject(new Error("password=secreto"))) });
    const res = await createHealthHandler(deps)();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded" });
    expect(deps.log).toHaveBeenCalledWith("db");
    expect(deps.log).not.toHaveBeenCalledWith(expect.stringContaining("secreto"));
  });

  it("503 degraded si falla Redis", async () => {
    const deps = makeDeps({ checkRedis: vi.fn(async () => Promise.reject(new Error("x"))) });
    const res = await createHealthHandler(deps)();
    expect(res.status).toBe(503);
    expect(deps.log).toHaveBeenCalledWith("redis");
  });

  it("503 si una comprobación se cuelga más allá del tiempo límite", async () => {
    const deps = makeDeps({ checkRedis: vi.fn(() => new Promise<void>(() => undefined)) });
    const res = await createHealthHandler(deps, { timeoutMs: 20 })();
    expect(res.status).toBe(503);
    expect(deps.log).toHaveBeenCalledWith("redis");
  });

  it("la respuesta no revela detalles internos", async () => {
    const deps = makeDeps({ checkDb: vi.fn(async () => Promise.reject(new Error("connection to 10.0.0.5 refused"))) });
    const res = await createHealthHandler(deps)();
    expect(JSON.stringify(await res.json())).not.toMatch(/10\.0|connection|refused/);
  });

  it("guarda el resultado unos segundos: no golpea la base en cada solicitud", async () => {
    let t = 1_000;
    const deps = makeDeps();
    const get = createHealthHandler(deps, { now: () => t });
    await get();
    await get();
    await get();
    expect(deps.checkDb).toHaveBeenCalledTimes(1);
    expect(deps.checkRedis).toHaveBeenCalledTimes(1);
    t += HEALTH_CACHE_MS + 1;
    await get();
    expect(deps.checkDb).toHaveBeenCalledTimes(2);
  });

  it("solicitudes simultáneas comparten una sola comprobación", async () => {
    const deps = makeDeps();
    const get = createHealthHandler(deps);
    await Promise.all([get(), get(), get(), get()]);
    expect(deps.checkDb).toHaveBeenCalledTimes(1);
  });

  it("no queda cacheado en el navegador y el CDN lo guarda pocos segundos", async () => {
    const res = await createHealthHandler(makeDeps())();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=10");
  });
});
