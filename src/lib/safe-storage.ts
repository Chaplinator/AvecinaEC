// localStorage puede lanzar errores (modo privado, datos bloqueados): nunca debe romper la app.
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: la app sigue funcionando */
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* sin almacenamiento */
  }
}
