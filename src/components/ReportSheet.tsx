"use client";

import { useEffect, useRef, useState } from "react";
import { sendReport } from "@/lib/report-client";
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

type Phase = "choose" | "sending" | "done";

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

  const needsProvider = type === "internet";
  const canSend = zone !== null && type !== null && (!needsProvider || provider !== null) && phase !== "sending";

  const submit = async () => {
    if (!zone || !type || !canSend) return;
    setPhase("sending");
    setErrorCode(null);
    const result = await sendReport({
      type,
      status_value: defaultStatusFor(type),
      h3_cell: zone,
      ...(type === "internet" && provider ? { provider } : {}),
      client_request_id: requestId.current,
    });
    if (result.ok) {
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
      className="m-auto w-[min(94vw,28rem)] rounded-2xl border border-zinc-300 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
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
            className="mt-5 min-h-11 w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-medium text-white"
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
            className="mt-5 min-h-11 w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-medium text-white"
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
                    ? "border-blue-700 bg-blue-700 text-white"
                    : "border-zinc-400 bg-transparent"
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
                        ? "border-blue-700 bg-blue-700 text-white"
                        : "border-zinc-400 bg-transparent"
                    }`}
                  >
                    {provider === option ? "✓ " : ""}
                    {es.report.providers[option]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {errorText && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-700 dark:text-red-400">
              {errorText}
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="min-h-11 rounded-xl bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {phase === "sending" ? es.report.sending : es.report.send}
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="min-h-11 rounded-xl border border-zinc-400 px-4 py-2 text-sm font-medium"
            >
              {es.report.cancel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
