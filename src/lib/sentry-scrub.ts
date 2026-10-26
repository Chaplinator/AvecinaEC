import type { Breadcrumb, ErrorEvent } from "@sentry/browser";

// Los valores por defecto del SDK recopilan usuario, cookies, headers y cuerpos.
// Aquí se apaga todo; scrubEvent es la segunda barrera.
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  stackFrameVariables: false,
  databaseQueryData: false,
  queues: false,
} as const;

// Privacidad (CLAUDE.md §10): ningún dato personal en Sentry.
// Quita usuario, IP, cookies, headers, cuerpo y query string de cada evento.
export function scrubEvent<T extends ErrorEvent>(event: T): T {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
  }
  return event;
}

// Breadcrumbs: sin consola (puede traer texto de usuario) y sin query ni hash en las URLs.
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      const value = data[key];
      if (typeof value === "string") data[key] = value.split(/[?#]/)[0];
    }
  }
  return breadcrumb;
}
