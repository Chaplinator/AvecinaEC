// Cloudflare Turnstile cargado a demanda: solo se descarga cuando el servidor pide verificación
// (primer reporte de una persona sin sesión). Quien ya tiene sesión nunca baja este script.
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TIMEOUT_MS = 45_000;

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      loading = null; // permite reintentar si fue un corte de red
      script.remove();
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

// Devuelve un token de un solo uso. Casi siempre es invisible; si Cloudflare necesita una
// interacción, el widget aparece dentro de `container`. Rechaza si falla o tarda demasiado.
export async function solveCaptcha(container: HTMLElement, siteKey: string): Promise<string> {
  const api = await loadScript();
  return new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null;
    function settle(finish: () => void) {
      clearTimeout(timer);
      if (widgetId !== null) api.remove(widgetId);
      finish();
    }
    const timer = setTimeout(() => settle(() => reject(new Error("turnstile"))), TIMEOUT_MS);
    widgetId = api.render(container, {
      sitekey: siteKey,
      appearance: "interaction-only",
      callback: (token) => settle(() => resolve(token)),
      "error-callback": () => settle(() => reject(new Error("turnstile"))),
      "expired-callback": () => settle(() => reject(new Error("turnstile"))),
    });
  });
}
