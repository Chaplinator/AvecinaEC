import { NextRequest, NextResponse } from "next/server";
import { latLngToCell } from "h3-js";
import { describe, expect, it, vi } from "vitest";
import {
  RateLimitedError,
  ServiceUnavailableError,
  createReportsHandler,
  type Deps,
} from "@/lib/server/reports-handler";

const URL = "https://app.test/api/v1/reports";
const CELL = "888f2b98edfffff"; // Guayaquil, resolución 8
const RID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER = "11111111-1111-4111-8111-111111111111";

function validBody(overrides: Record<string, unknown> = {}) {
  return { type: "power", status_value: "out", h3_cell: CELL, client_request_id: RID, ...overrides };
}

function post(
  body: unknown,
  headers: Record<string, string> = { origin: "https://app.test", "content-type": "application/json" },
) {
  return new NextRequest(URL, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    clientKey: () => "ip-hash",
    limitIp: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
    limitUser: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
    ensureSession: vi.fn(async () => ({ userId: USER, tokens: null })),
    seenRequest: vi.fn(async () => false),
    markRequest: vi.fn(async () => undefined),
    claimSlot: vi.fn(async () => true),
    releaseSlot: vi.fn(async () => undefined),
    insertReport: vi.fn(async () => "created" as const),
    applySession: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

async function errorOf(response: Response) {
  return (await response.json()).error as { code: string; message: string; requestId: string; fields?: string[] };
}

describe("POST /api/v1/reports", () => {
  it("guarda un reporte válido y responde 201", async () => {
    const deps = makeDeps();
    const res = await createReportsHandler(deps)(post(validBody()));
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("created");
    expect(deps.insertReport).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER, type: "power", h3_cell: CELL, provider: null, source: "manual" }),
    );
    expect(deps.markRequest).toHaveBeenCalledOnce();
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("acepta un reporte de internet con proveedor", async () => {
    const deps = makeDeps();
    const res = await createReportsHandler(deps)(post(validBody({ type: "internet", provider: "netlife" })));
    expect(res.status).toBe(201);
    expect(deps.insertReport).toHaveBeenCalledWith(expect.objectContaining({ provider: "netlife" }));
  });

  it("entrega las cookies de sesión cuando se crea una sesión nueva", async () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresIn: 3600 };
    const deps = makeDeps({ ensureSession: vi.fn(async () => ({ userId: USER, tokens })) });
    await createReportsHandler(deps)(post(validBody()));
    expect(deps.applySession).toHaveBeenCalledWith(expect.any(NextResponse), tokens);
  });

  it("rechaza un Origin distinto sin tocar nada (CSRF)", async () => {
    const deps = makeDeps();
    const res = await createReportsHandler(deps)(
      post(validBody(), { origin: "https://malo.test", "content-type": "application/json" }),
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("FORBIDDEN");
    expect(deps.limitIp).not.toHaveBeenCalled();
  });

  it("rechaza solicitudes sin Origin", async () => {
    const res = await createReportsHandler(makeDeps())(post(validBody(), { "content-type": "application/json" }));
    expect(res.status).toBe(403);
  });

  it("rechaza un Content-Type que no es JSON", async () => {
    const res = await createReportsHandler(makeDeps())(
      post(validBody(), { origin: "https://app.test", "content-type": "text/plain" }),
    );
    expect(res.status).toBe(400);
  });

  it("rechaza cuerpos demasiado grandes", async () => {
    const res = await createReportsHandler(makeDeps())(post(validBody({ relleno: "x".repeat(3000) })));
    expect(res.status).toBe(413);
  });

  it("rechaza un envío declarado como cross-site aunque el Origin coincida", async () => {
    const deps = makeDeps();
    const res = await createReportsHandler(deps)(
      post(validBody(), { origin: "https://app.test", "content-type": "application/json", "sec-fetch-site": "cross-site" }),
    );
    expect(res.status).toBe(403);
    expect(deps.limitIp).not.toHaveBeenCalled();
  });

  it("acepta sec-fetch-site: same-origin", async () => {
    const res = await createReportsHandler(makeDeps())(
      post(validBody(), { origin: "https://app.test", "content-type": "application/json", "sec-fetch-site": "same-origin" }),
    );
    expect(res.status).toBe(201);
  });

  it("mide el cuerpo en bytes, no en caracteres", async () => {
    // 1.500 caracteres de 2 bytes = 3.000 bytes: pasaría un límite en caracteres, pero no en bytes.
    const res = await createReportsHandler(makeDeps())(post(validBody({ relleno: "ñ".repeat(1500) })));
    expect(res.status).toBe(413);
  });

  it("aplica el límite por IP antes de leer el cuerpo", async () => {
    const deps = makeDeps({ limitIp: vi.fn(async () => ({ ok: false, retryAfter: 60 })) });
    const request = post(validBody());
    const res = await createReportsHandler(deps)(request);
    expect(res.status).toBe(429);
    expect(request.bodyUsed).toBe(false);
  });

  it("429 cuando la IP ya creó demasiadas sesiones anónimas nuevas", async () => {
    const deps = makeDeps({
      ensureSession: vi.fn(async () => {
        throw new RateLimitedError(300);
      }),
    });
    const res = await createReportsHandler(deps)(post(validBody()));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    expect(deps.insertReport).not.toHaveBeenCalled();
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it("pasa la llave de IP a ensureSession para limitar las altas nuevas", async () => {
    const deps = makeDeps();
    await createReportsHandler(deps)(post(validBody()));
    expect(deps.ensureSession).toHaveBeenCalledWith(expect.anything(), "ip-hash");
  });

  it("rechaza JSON mal formado", async () => {
    const res = await createReportsHandler(makeDeps())(post("{no es json"));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("BAD_REQUEST");
  });

  describe("validación", () => {
    const casos: Array<[string, Record<string, unknown>, string]> = [
      ["tipo desconocido", { type: "robo" }, "type"],
      ["campo extra", { sector: "x" }, "body"],
      ["proveedor en un tipo que no es internet", { provider: "cnt" }, "provider"],
      ["proveedor inexistente", { type: "internet", provider: "otraempresa" }, "provider"],
      ["inundación con estado 'out'", { type: "flood", status_value: "out" }, "status_value"],
      ["luz con estado de inundación", { status_value: "flood_level" }, "status_value"],
      ["coordenadas en lugar de celda", { h3_cell: "-2.17,-79.9" }, "h3_cell"],
      ["celda de resolución 10", { h3_cell: "8a28308281fffff" }, "h3_cell"],
      ["celda fuera de cobertura (Quito)", { h3_cell: latLngToCell(-0.18, -78.47, 8) }, "h3_cell"],
      ["celda con forma válida pero inexistente", { h3_cell: "88ffffffffffffff".slice(0, 15) }, "h3_cell"],
      ["identificador que no es UUID", { client_request_id: "123" }, "client_request_id"],
    ];
    for (const [nombre, cambio, campo] of casos) {
      it(`422: ${nombre}`, async () => {
        const deps = makeDeps();
        const res = await createReportsHandler(deps)(post(validBody(cambio)));
        expect(res.status).toBe(422);
        const error = await errorOf(res);
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(error.fields).toContain(campo);
        expect(deps.ensureSession).not.toHaveBeenCalled();
        expect(deps.insertReport).not.toHaveBeenCalled();
      });
    }

    it("422 cuando falta client_request_id", async () => {
      const body = validBody();
      delete (body as Record<string, unknown>).client_request_id;
      const res = await createReportsHandler(makeDeps())(post(body));
      expect(res.status).toBe(422);
    });
  });

  describe("límites", () => {
    it("429 con Retry-After cuando se pasa el límite por IP, sin crear sesión", async () => {
      const deps = makeDeps({ limitIp: vi.fn(async () => ({ ok: false, retryAfter: 120 })) });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("120");
      expect((await errorOf(res)).code).toBe("RATE_LIMITED");
      expect(deps.ensureSession).not.toHaveBeenCalled();
    });

    it("429 cuando se pasa el límite por usuario", async () => {
      const deps = makeDeps({ limitUser: vi.fn(async () => ({ ok: false, retryAfter: 900 })) });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("900");
      expect(deps.insertReport).not.toHaveBeenCalled();
    });

    it("429 por 10 minutos cuando ya reportó ese tipo en esa celda", async () => {
      const deps = makeDeps({ claimSlot: vi.fn(async () => false) });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("600");
      expect(deps.insertReport).not.toHaveBeenCalled();
    });

    it("503 con Retry-After si Redis no está disponible (falla cerrado)", async () => {
      const deps = makeDeps({
        limitIp: vi.fn(async () => {
          throw new ServiceUnavailableError("redis caído");
        }),
      });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("30");
      expect(deps.insertReport).not.toHaveBeenCalled();
    });
  });

  describe("idempotencia", () => {
    it("un reintento con el mismo client_request_id responde 200 sin repetir nada", async () => {
      const deps = makeDeps({ seenRequest: vi.fn(async () => true) });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect(res.status).toBe(200);
      expect((await res.json()).data.status).toBe("duplicate");
      expect(deps.claimSlot).not.toHaveBeenCalled();
      expect(deps.insertReport).not.toHaveBeenCalled();
    });

    it("si la base ya tenía el reporte (unique) responde 200", async () => {
      const deps = makeDeps({ insertReport: vi.fn(async () => "duplicate" as const) });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect(res.status).toBe(200);
    });
  });

  describe("errores internos", () => {
    it("500 genérico sin detalles, libera el cupo y registra el error", async () => {
      const secreto = "password authentication failed for user postgres at 10.0.0.5";
      const deps = makeDeps({
        insertReport: vi.fn(async () => {
          throw new Error(secreto);
        }),
      });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect(res.status).toBe(500);
      const text = JSON.stringify(await errorOf(res));
      expect(text).not.toContain("postgres");
      expect(text).not.toContain("10.0.0.5");
      expect(deps.releaseSlot).toHaveBeenCalledWith(USER, "power", CELL);
      expect(deps.markRequest).not.toHaveBeenCalled();
      expect(deps.logError).toHaveBeenCalledOnce();
    });

    it("el requestId del error coincide con el encabezado", async () => {
      const deps = makeDeps({ limitIp: vi.fn(async () => ({ ok: false, retryAfter: 5 })) });
      const res = await createReportsHandler(deps)(post(validBody()));
      expect((await errorOf(res)).requestId).toBe(res.headers.get("x-request-id"));
    });
  });
});
