import type { ErrorEvent } from "@sentry/browser";

// Los valores por defecto del SDK recopilan usuario, cookies, headers y cuerpos.
// Aquí se apaga todo; scrubEvent es la segunda barrera.
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
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
