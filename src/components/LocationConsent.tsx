"use client";

import { useEffect, useRef } from "react";
import { es } from "@/i18n/es";

type Props = {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

// Consentimiento explícito antes de pedir la ubicación (LOPDP, CLAUDE.md §10).
export default function LocationConsent({ open, onAccept, onDecline }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="consent-title"
      onCancel={(e) => {
        e.preventDefault();
        onDecline();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-surface p-6 text-fg shadow-xl backdrop:bg-black/50"
    >
      <h2 id="consent-title" className="text-lg font-semibold">
        {es.consent.title}
      </h2>
      <p className="mt-3 text-sm leading-6">{es.consent.body}</p>
      <p className="mt-2 text-sm leading-6">{es.consent.privacy}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={onAccept}
          className="min-h-11 rounded-xl bg-action px-4 py-2 text-sm font-medium text-on-action"
        >
          {es.consent.accept}
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="min-h-11 rounded-xl border border-line-strong px-4 py-2 text-sm font-medium"
        >
          {es.consent.decline}
        </button>
      </div>
    </dialog>
  );
}
