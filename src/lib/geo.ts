// Constantes y utilidades geográficas. La ubicación exacta nunca sale del teléfono:
// se convierte a una celda H3 de resolución 8 (~0,7 km²) antes de usarla (CLAUDE.md §6).
export const H3_RESOLUTION = 8;

export type Bounds = { south: number; north: number; west: number; east: number };

// Extensión de las teselas autoalojadas (Guayaquil, Durán y Samborondón).
export const MAP_BOUNDS: Bounds = { south: -2.4, north: -1.95, west: -80.1, east: -79.75 };

// Zona urbana donde se dibuja la grilla de celdas.
export const GRID_BOUNDS: Bounds = { south: -2.31, north: -2.03, west: -80.02, east: -79.82 };

export const CITY_CENTER = { lat: -2.17, lng: -79.92 } as const;

// Archivo versionado: el nombre cambia cuando se actualizan las calles.
export const TILES_URL = "/tiles/guayaquil-20261026.pmtiles";

export function isInsideBounds(lat: number, lng: number, b: Bounds): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= b.south &&
    lat <= b.north &&
    lng >= b.west &&
    lng <= b.east
  );
}

// Índice H3 válido para nuestro uso: resolución 8 en minúsculas, 15 caracteres hexadecimales.
export function isH3Cell(value: unknown): value is string {
  return typeof value === "string" && /^88[0-9a-f]{13}$/.test(value);
}
