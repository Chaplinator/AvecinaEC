export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    // Solo https; http únicamente para localhost (desarrollo y pruebas).
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin;
    return null;
  } catch {
    return null;
  }
}

// Orígenes externos permitidos para fetch/WebSocket. Siempre explícitos, sin comodines.
export function connectOrigins(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  const sentry = originOf(env.NEXT_PUBLIC_SENTRY_DSN);
  if (sentry) out.push(sentry);
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (supabase) out.push(supabase, supabase.replace(/^http/, "ws"));
  return out;
}

// Cloudflare Turnstile (captcha): solo se permite si el sitio tiene configurada su llave pública.
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export function captchaOrigins(env: Record<string, string | undefined>): string[] {
  return env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? [TURNSTILE_ORIGIN] : [];
}

export function buildCsp(nonce: string, isDev: boolean, connect: string[] = [], frames: string[] = []): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${connect.length ? " " + connect.join(" ") : ""}`,
    `frame-src ${frames.length ? frames.join(" ") : "'none'"}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}
