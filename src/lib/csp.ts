export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
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

export function buildCsp(nonce: string, isDev: boolean, connect: string[] = []): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${connect.length ? " " + connect.join(" ") : ""}`,
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
