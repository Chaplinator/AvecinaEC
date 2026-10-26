import { z } from "zod";
import { cellToLatLng, isValidCell } from "h3-js";
import { MAP_BOUNDS, isH3Cell, isInsideBounds } from "@/lib/geo";
import { PROVIDERS, REPORT_TYPES, STATUS_VALUES } from "@/lib/report-types";

// Entrada de POST /api/v1/reports. Estricta: campos desconocidos se rechazan.
export const reportSchema = z
  .object({
    type: z.enum(REPORT_TYPES),
    status_value: z.enum(STATUS_VALUES),
    h3_cell: z.string().refine(isH3Cell, "Celda H3 inválida"),
    provider: z.enum(PROVIDERS).optional(),
    client_request_id: z.uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // La celda debe ser un índice H3 real y estar dentro de la zona que cubrimos.
    if (isH3Cell(value.h3_cell)) {
      const valid = isValidCell(value.h3_cell);
      const [lat, lng] = valid ? cellToLatLng(value.h3_cell) : [Number.NaN, Number.NaN];
      if (!valid || !isInsideBounds(lat, lng, MAP_BOUNDS)) {
        ctx.addIssue({ code: "custom", path: ["h3_cell"], message: "Celda fuera de cobertura" });
      }
    }
    if (value.provider !== undefined && value.type !== "internet") {
      ctx.addIssue({ code: "custom", path: ["provider"], message: "Solo para internet" });
    }
    if (value.type === "flood" && value.status_value !== "flood_level") {
      ctx.addIssue({ code: "custom", path: ["status_value"], message: "Valor inválido para inundación" });
    }
    if (value.type !== "flood" && value.status_value === "flood_level") {
      ctx.addIssue({ code: "custom", path: ["status_value"], message: "Valor inválido para este tipo" });
    }
  });

export type ReportInput = z.infer<typeof reportSchema>;
