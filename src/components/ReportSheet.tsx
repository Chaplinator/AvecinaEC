"use client";

import { useEffect, useRef, useState } from "react";
import { sendReport } from "@/lib/report-client";
import { readStorage, writeStorage } from "@/lib/safe-storage";
import {
  PROVIDERS,
  REPORT_TYPES,
  defaultStatusFor,
  type Provider,
  type ReportType,
} from "@/lib/report-types";
import { es } from "@/i18n/es";

type Props = {
  zone: string | null;
  onClose: () => void;
};

type Phase = "choose" | "sending" | "verifying" | "done";

// Marca local de que este teléfono ya creó su sesión anónima (la cookie real es HttpOnly y no se puede leer).
// Si la marca está desactualizada, el servidor pide captcha y el flujo de respaldo lo resuelve.
const SESSION_FLAG = "sefue:session";

// Reporte en dos toques: qué pasa y enviar. Solo internet pide además el proveedor.
export default function ReportSheet({ zone, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<ReportType | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [phase, setPhase] = useState<Phase>("choose");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // El mismo identificador se reutiliza en los reintentos: si el primer envío sí llegó, no se duplica.
  const requestId = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const captchaBox = useRef<HTMLDivElement>(null);
  // Token de captcha resuelto por adelantado, mientras la persona elige el tipo de incidente.
  const pretoken = useRef<Promise<string | undefined> | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const hasZone = zone !== null;

  useEffect(() => {
    // Solo quien aún no tiene sesión necesitará el captcha: los demás no descargan nada.
    if (!siteKey || !hasZone || readStorage(SESSION_FLAG) || pretoken.current) return;
    const box = captchaBox.current;
    if (!box) return;
    pretoken.current = import("@/lib/turnstile")
      .then(({ solveCaptcha }) => solveCaptcha(box, siteKey))
      .catch(() => undefined);
  }, [siteKey, hasZone]);

  const needsProvider = type === "internet";
  const busy = phase === "sending" || phase === "verifying";
  const canSend = zone !== null && type !== null && (!needsProvider || provider !== null) && !busy;

  const submit = async () => {
    if (!zone || !type || !canSend) return;
    setPhase("sending");
    setErrorCode(null);
    const payload = {
      type,
      status_value: defaultStatusFor(type),
      h3_cell: zone,
      ...(type === "internet" && provider ? { provider } : {}),
      client_request_id: requestId.current,
    };
    // El token es de un solo uso: si ya estaba resuelto, viaja en el primer envío y se evita un viaje extra.
    const early = pretoken.current ? await pretoken.current : undefined;
    pretoken.current = null;
    let result = await sendReport(payload, early);
    // Respaldo: el servidor pide verificar que es una persona y aún no hay token válido.
    if (!result.ok && result.code === "CAPTCHA_REQUIRED" && siteKey && captchaBox.current) {
      setPhase("verifying");
      try {
        const { solveCaptcha } = await import("@/lib/turnstile");
        const token = await solveCaptcha(captchaBox.current, siteKey);
        setPhase("sending");
        result = await sendReport(payload, token);
      } catch {
        result = { ok: false, code: "CAPTCHA_UNAVAILABLE" };
      }
    }
    if (result.ok) {
      writeStorage(SESSION_FLAG, "1");
      setPhase("done");
    } else {
      setErrorCode(result.code);
      setPhase("choose");
    }
  };

  const errorText = errorCode
    ? (es.report.errors as Record<string, string>)[errorCode] ?? es.report.errors.INTERNAL
    : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="report-title"
      onClose={onClose}
      className="m-auto w-[min(94vw,28rem)] rounded-2xl border border-line bg-surface p-5 text-fg shadow-xl backdrop:bg-black/50"
    >
      <h2 id="report-title" className="text-lg font-semibold">
        {phase === "done" ? es.report.doneTitle : es.report.title}
      </h2>

      {phase === "done" ? (
        <>
          <p className="mt-3 text-sm leading-6">{es.report.doneBody}</p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="mt-5 min-h-11 w-full rounded-xl bg-action px-4 py-2 text-sm font-medium text-on-action"
          >
            {es.report.close}
          </button>
        </>
      ) : zone === null ? (
        <>
          <p className="mt-3 text-sm leading-6">{es.report.needZone}</p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="mt-5 min-h-11 w-full rounded-xl bg-action px-4 py-2 text-sm font-medium text-on-action"
          >
            {es.report.chooseZone}
          </button>
        </>
      ) : (
        <>
          <div role="group" aria-label={es.report.title} className="mt-4 grid gap-2">
            {REPORT_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={type === option}
                onClick={() => {
                  setType(option);
                  if (option !== "internet") setProvider(null);
                }}
                className={`min-h-12 rounded-xl border px-4 py-2 text-left text-sm font-medium ${
                  type === option
                    ? "border-action bg-action text-on-action"
                    : "border-line-strong bg-transparent"
                }`}
              >
                {type === option ? "✓ " : ""}
                {es.report.types[option]}
              </button>
            ))}
          </div>

          {needsProvider && (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">{es.report.providerTitle}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PROVIDERS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={provider === option}
                    onClick={() => setProvider(option)}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-sm ${
                      provider === option
                        ? "border-action bg-action text-on-action"
                        : "border-line-strong bg-transparent"
                    }`}
                  >
                    {provider === option ? "✓ " : ""}
                    {es.report.providers[option]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div ref={captchaBox} className="mt-4 flex justify-center empty:hidden" />
          {phase === "verifying" && (
            <p role="status" className="mt-4 text-sm">
              {es.report.verifying}
            </p>
          )}

          {errorText && (
            <p role="alert" className="mt-4 text-sm font-medium text-danger">
              {errorText}
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="min-h-11 rounded-xl bg-action px-4 py-2 text-sm font-medium text-on-action disabled:opacity-50"
            >
              {busy ? es.report.sending : es.report.send}
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="min-h-11 rounded-xl border border-line-strong px-4 py-2 text-sm font-medium"
            >
              {es.report.cancel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
