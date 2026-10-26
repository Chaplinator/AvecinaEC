"use client";

import { useSyncExternalStore } from "react";
import { isH3Cell } from "@/lib/geo";
import { readStorage, removeStorage, writeStorage } from "@/lib/safe-storage";

// Zona elegida por la persona: es una celda H3 (nunca una coordenada). Vive solo en el teléfono.
const ZONE_KEY = "sefue.zone";
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

function getSnapshot(): string | null {
  const saved = readStorage(ZONE_KEY);
  return isH3Cell(saved) ? saved : null;
}

export function setZone(cell: string): void {
  if (!isH3Cell(cell)) return;
  writeStorage(ZONE_KEY, cell);
  notify();
}

export function clearZone(): void {
  removeStorage(ZONE_KEY);
  notify();
}

// En el servidor no hay zona: el primer render coincide y luego React la lee del teléfono.
export function useZone(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
