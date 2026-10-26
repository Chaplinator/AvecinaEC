import { describe, expect, it } from "vitest";
import { CITY_CENTER, GRID_BOUNDS, MAP_BOUNDS, isH3Cell, isInsideBounds } from "./geo";

describe("geo", () => {
  it("el centro de la ciudad cae dentro del mapa y de la grilla", () => {
    expect(isInsideBounds(CITY_CENTER.lat, CITY_CENTER.lng, MAP_BOUNDS)).toBe(true);
    expect(isInsideBounds(CITY_CENTER.lat, CITY_CENTER.lng, GRID_BOUNDS)).toBe(true);
  });

  it("la grilla está contenida en el área de teselas", () => {
    expect(GRID_BOUNDS.south).toBeGreaterThanOrEqual(MAP_BOUNDS.south);
    expect(GRID_BOUNDS.north).toBeLessThanOrEqual(MAP_BOUNDS.north);
    expect(GRID_BOUNDS.west).toBeGreaterThanOrEqual(MAP_BOUNDS.west);
    expect(GRID_BOUNDS.east).toBeLessThanOrEqual(MAP_BOUNDS.east);
  });

  it("rechaza puntos fuera del área y valores no numéricos", () => {
    expect(isInsideBounds(-0.18, -78.47, MAP_BOUNDS)).toBe(false); // Quito
    expect(isInsideBounds(Number.NaN, -79.9, MAP_BOUNDS)).toBe(false);
    expect(isInsideBounds(-2.17, Number.POSITIVE_INFINITY, MAP_BOUNDS)).toBe(false);
  });

  it("acepta solo celdas H3 de resolución 8", () => {
    expect(isH3Cell("8828308281fffff")).toBe(true);
    expect(isH3Cell("8a28308281fffff")).toBe(false); // resolución 10
    expect(isH3Cell("-2.17,-79.9")).toBe(false);
    expect(isH3Cell(123)).toBe(false);
    expect(isH3Cell("8828308281FFFFF")).toBe(false);
    expect(isH3Cell("")).toBe(false);
    expect(isH3Cell("8928308281fffff")).toBe(false); // resolución 9
    expect(isH3Cell("8828308281ffffff")).toBe(false); // 16 caracteres
    expect(isH3Cell({})).toBe(false);
    expect(isH3Cell(null)).toBe(false);
  });
});
