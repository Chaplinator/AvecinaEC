// Tipos y constantes de los reportes, compartidos entre navegador y servidor.
// No importa Zod a propósito: en el navegador pesaría ~13 KB y el presupuesto de JS está al límite.
// La validación completa vive en el servidor (src/lib/server/reports-schema.ts).
export const REPORT_TYPES = ["power", "water", "internet", "flood"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const PROVIDERS = ["netlife", "cnt", "claro", "xtrim", "otro"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const STATUS_VALUES = ["out", "back", "flood_level"] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];

export type ReportPayload = {
  type: ReportType;
  status_value: StatusValue;
  h3_cell: string;
  provider?: Provider;
  client_request_id: string;
};

// Qué estado se reporta por defecto para cada tipo: algo "se fue" o hay inundación.
export function defaultStatusFor(type: ReportType): StatusValue {
  return type === "flood" ? "flood_level" : "out";
}

export const REPORTS_ENDPOINT = "/api/v1/reports";
