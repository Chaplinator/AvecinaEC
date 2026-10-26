"use client";

import { useSyncExternalStore } from "react";
import { readStorage, removeStorage, writeStorage } from "@/lib/safe-storage";

// Consentimiento para usar la ubicación (LOPDP). Se guarda solo en el teléfono y se puede retirar.
const CONSENT_KEY = "sefue.consent.location";
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): boolean {
  return readStorage(CONSENT_KEY) === "1";
}

export function giveLocationConsent(): void {
  writeStorage(CONSENT_KEY, "1");
  notify();
}

export function withdrawLocationConsent(): void {
  removeStorage(CONSENT_KEY);
  notify();
}

export function useLocationConsent(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
