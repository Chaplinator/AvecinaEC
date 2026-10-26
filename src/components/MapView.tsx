"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polygon, Renderer } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  CITY_CENTER,
  GRID_BOUNDS,
  H3_RESOLUTION,
  MAP_BOUNDS,
  TILES_URL,
  isInsideBounds,
} from "@/lib/geo";
import { clearZone } from "@/lib/zone-store";
import { es } from "@/i18n/es";

type H3 = typeof import("h3-js");
type Leaflet = typeof import("leaflet");

type Props = {
  selectedCell: string | null;
  onPickCell: (cell: string) => void;
};

// El mapa pesa (Leaflet + calles + H3): vive en su propio bloque que solo se descarga en diferido.
export default function MapView({ selectedCell, onPickCell }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const libsRef = useRef<{ L: Leaflet; h3: H3; renderer: Renderer } | null>(null);
  const highlightRef = useRef<Polygon | null>(null);
  const pickRef = useRef(onPickCell);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pickRef.current = onPickCell;
  }, [onPickCell]);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    (async () => {
      const [leafletModule, protomaps, h3] = await Promise.all([
        import("leaflet"),
        import("protomaps-leaflet"),
        import("h3-js"),
      ]);
      const L = (leafletModule.default ?? leafletModule) as Leaflet;
      if (cancelled || !containerRef.current) return;

      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      map = L.map(containerRef.current, {
        center: [CITY_CENTER.lat, CITY_CENTER.lng],
        zoom: 12,
        minZoom: 10,
        maxZoom: 16,
        maxBounds: [
          [MAP_BOUNDS.south, MAP_BOUNDS.west],
          [MAP_BOUNDS.north, MAP_BOUNDS.east],
        ],
        maxBoundsViscosity: 1,
        preferCanvas: true,
      });
      map.attributionControl.setPrefix(false);

      protomaps
        .leafletLayer({
          url: TILES_URL,
          flavor: dark ? "dark" : "light",
          lang: "es",
          attribution: es.map.attribution,
        })
        .addTo(map);

      const renderer = L.canvas({ padding: 0.25 });

      // Grilla de celdas H3 de la zona urbana: una sola capa con todos los anillos y sin eventos.
      // Se construye en un momento ocioso para no competir con el primer dibujo de las calles.
      const drawGrid = () => {
        if (cancelled || !map) return;
        const { south, north, west, east } = GRID_BOUNDS;
        const cells = h3.polygonToCells(
          [
            [south, west],
            [south, east],
            [north, east],
            [north, west],
          ],
          H3_RESOLUTION,
        );
        const rings = cells.map((cell) => h3.cellToBoundary(cell) as [number, number][]);
        L.polygon(rings, {
          renderer,
          weight: 1,
          color: dark ? "#94a3b8" : "#475569",
          opacity: 0.3,
          fillOpacity: 0,
          interactive: false,
        }).addTo(map);
      };
      if ("requestIdleCallback" in window) requestIdleCallback(drawGrid, { timeout: 2000 });
      else setTimeout(drawGrid, 300);

      map.on("click", (e) => {
        const { lat, lng } = e.latlng;
        if (!isInsideBounds(lat, lng, MAP_BOUNDS)) return;
        pickRef.current(h3.latLngToCell(lat, lng, H3_RESOLUTION));
      });

      mapRef.current = map;
      libsRef.current = { L, h3, renderer };
      setReady(true);
    })();

    return () => {
      cancelled = true;
      setReady(false);
      map?.remove();
      mapRef.current = null;
      libsRef.current = null;
      highlightRef.current = null;
    };
  }, []);

  // Resalta la zona elegida.
  useEffect(() => {
    const map = mapRef.current;
    const libs = libsRef.current;
    if (!ready || !map || !libs) return;
    highlightRef.current?.remove();
    highlightRef.current = null;
    if (!selectedCell) return;
    // Un valor manipulado en el almacenamiento no debe romper el mapa.
    if (!libs.h3.isValidCell(selectedCell)) {
      clearZone();
      return;
    }
    const boundary = libs.h3.cellToBoundary(selectedCell) as [number, number][];
    const polygon = libs.L.polygon(boundary, {
      renderer: libs.renderer,
      weight: 3,
      color: "#2563eb",
      fillColor: "#2563eb",
      fillOpacity: 0.2,
      interactive: false,
    }).addTo(map);
    highlightRef.current = polygon;
    map.fitBounds(polygon.getBounds(), { maxZoom: 14, padding: [40, 40] });
  }, [selectedCell, ready]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={es.map.ariaLabel}
      className="h-full w-full bg-zinc-100 dark:bg-zinc-900"
    >
      {!ready && (
        <p className="p-4 text-sm" role="status">
          {es.map.loading}
        </p>
      )}
    </div>
  );
}
