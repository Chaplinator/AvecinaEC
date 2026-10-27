"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import LocationConsent from "@/components/LocationConsent";
import { H3_RESOLUTION, MAP_BOUNDS, isInsideBounds } from "@/lib/geo";
import { giveLocationConsent, useLocationConsent, withdrawLocationConsent } from "@/lib/consent-store";
import { clearZone, setZone, useZone } from "@/lib/zone-store";
import { es } from "@/i18n/es";

// El mapa se descarga aparte y solo en el navegador (no en el servidor).
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <p className="p-4 text-sm" role="status">
      {es.map.loading}
    </p>
  ),
});

// La hoja de reporte se descarga solo cuando alguien la abre.
const ReportSheet = dynamic(() => import("@/components/ReportSheet"), { ssr: false });

type Status = "idle" | "locating" | "denied" | "unavailable" | "outside";

export default function HomeClient() {
  const selectedCell = useZone();
  const hasConsent = useLocationConsent();
  const [consentOpen, setConsentOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");

  const pickCell = useCallback((cell: string) => {
    setZone(cell);
    setStatus("idle");
  }, []);

  const clearCell = clearZone;

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          if (!isInsideBounds(latitude, longitude, MAP_BOUNDS)) {
            setStatus("outside");
            return;
          }
          // Las coordenadas exactas se convierten aquí y no se guardan ni se envían.
          const h3 = await import("h3-js");
          pickCell(h3.latLngToCell(latitude, longitude, H3_RESOLUTION));
        } catch {
          // Si falla la carga (mala red), el botón no debe quedar bloqueado.
          setStatus("unavailable");
        }
      },
      (error) => setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [pickCell]);

  const onUseLocation = () => {
    if (hasConsent) locate();
    else setConsentOpen(true);
  };

  const accept = () => {
    giveLocationConsent();
    setConsentOpen(false);
    locate();
  };

  const withdraw = () => {
    withdrawLocationConsent();
    setStatus("idle");
  };

  const decline = () => {
    setConsentOpen(false);
    setStatus("denied");
  };

  const message =
    status === "locating"
      ? es.location.locating
      : status === "denied"
        ? es.location.denied
        : status === "unavailable"
          ? es.location.unavailable
          : status === "outside"
            ? es.location.outside
            : selectedCell
              ? es.zone.selected
              : es.zone.none;

  return (
    <div className="flex h-dvh flex-col">
      <header className="px-4 py-3">
        <h1>
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet="/avecina-logo-negativo.svg" />
            <img src="/avecina-logo.svg" alt={es.app.name} width={152} height={48} className="h-12 w-[9.5rem]" />
          </picture>
        </h1>
        <p className="mt-1 text-sm font-medium">{es.app.tagline}</p>
        <p className="text-sm text-muted">{es.app.description}</p>
      </header>

      <main className="relative min-h-0 flex-1">
        <MapView selectedCell={selectedCell} onPickCell={pickCell} />
      </main>

      <section className="space-y-2 px-4 py-3" aria-live="polite">
        {/* Altura reservada: los mensajes cambian de largo y no deben mover el mapa (CLS). */}
        <p className="min-h-[3.5rem] text-sm">{message}</p>
        <div className="flex min-h-11 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="min-h-11 rounded-xl bg-action px-4 py-2 text-sm font-semibold text-on-action"
          >
            {es.report.open}
          </button>
          <button
            type="button"
            onClick={onUseLocation}
            disabled={status === "locating"}
            className="min-h-11 rounded-xl border border-line-strong px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {es.location.use}
          </button>
          {selectedCell && (
            <button
              type="button"
              onClick={clearCell}
              className="min-h-11 rounded-xl border border-line-strong px-4 py-2 text-sm font-medium"
            >
              {es.zone.clear}
            </button>
          )}
          {hasConsent && (
            <button
              type="button"
              onClick={withdraw}
              className="min-h-11 rounded-xl px-2 py-2 text-sm underline"
            >
              {es.location.withdraw}
            </button>
          )}
        </div>
        <p className="text-xs text-muted">
          {es.app.unofficial} {es.app.emergency}
        </p>
      </section>

      <LocationConsent open={consentOpen} onAccept={accept} onDecline={decline} />
      {reportOpen && <ReportSheet zone={selectedCell} onClose={() => setReportOpen(false)} />}
    </div>
  );
}
