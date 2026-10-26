import { NextRequest, NextResponse } from "next/server";
import { buildCsp, captchaOrigins, connectOrigins, generateNonce } from "@/lib/csp";

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const captcha = captchaOrigins(process.env);
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development", [...connectOrigins(process.env), ...captcha], captcha);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Las teselas (/tiles) son binarios estáticos: sin proxy ni nonce, se sirven directo del CDN.
      source: "/((?!api|tiles/|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
