import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/browser";
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from "./sentry-scrub";

describe("scrubEvent", () => {
  it("elimina usuario, cookies, headers, cuerpo y query", () => {
    const event = {
      type: undefined,
      user: { ip_address: "1.2.3.4", id: "u1" },
      request: {
        url: "https://x.test/p",
        cookies: { sb: "token" },
        headers: { authorization: "Bearer abc" },
        data: { lat: -2.17, lng: -79.9 },
        query_string: "lat=-2.17",
      },
    } as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.url).toBe("https://x.test/p");
  });

  it("no falla si el evento no trae request", () => {
    expect(() => scrubEvent({ type: undefined } as ErrorEvent)).not.toThrow();
  });
});

describe("sentryDataCollection", () => {
  it("apaga toda recopilación de datos personales", () => {
    expect(sentryDataCollection.userInfo).toBe(false);
    expect(sentryDataCollection.cookies).toBe(false);
    expect(sentryDataCollection.httpHeaders).toBe(false);
    expect(sentryDataCollection.httpBodies).toEqual([]);
    expect(sentryDataCollection.urlQueryParams).toBe(false);
    expect(sentryDataCollection.stackFrameVariables).toBe(false);
    expect(sentryDataCollection.databaseQueryData).toBe(false);
    expect(sentryDataCollection.queues).toBe(false);
  });
});

describe("scrubBreadcrumb", () => {
  it("descarta los breadcrumbs de consola", () => {
    expect(scrubBreadcrumb({ category: "console", message: "texto de usuario" })).toBeNull();
  });

  it("quita query y hash de las URLs", () => {
    const out = scrubBreadcrumb({
      category: "fetch",
      data: { url: "https://x.test/rest/v1/reports?user_id=eq.123#a", method: "GET" },
    });
    expect(out?.data?.url).toBe("https://x.test/rest/v1/reports");
    expect(out?.data?.method).toBe("GET");
  });
});
