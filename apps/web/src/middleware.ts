import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = /^\/(dashboard|learn|live|teach|admin|settings)(\/|$)/;

/**
 * Strict CSP: scripts run only with this request's nonce. Next.js applies the nonce to its
 * own scripts (it reads the CSP request header), and 'strict-dynamic' lets those trusted
 * scripts load others, such as Razorpay's checkout.js. Inline styles stay allowed because
 * React style attributes need them. Frames: Razorpay Checkout only.
 */
function contentSecurityPolicy(nonce: string) {
  const prod = process.env.NODE_ENV === "production";
  const realtime =
    process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";
  const storage = process.env.R2_ENDPOINT || "http://localhost:9000";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${prod ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // Note images and avatars are shown from short-lived pre-signed storage URLs (path-style).
    `img-src 'self' data: blob: https://lh3.googleusercontent.com ${storage}`,
    `connect-src 'self' ${realtime} ${prod ? "wss:" : "ws:"} https://api.razorpay.com https://lumberjack.razorpay.com ${storage}`,
    "frame-src https://api.razorpay.com https://checkout.razorpay.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    ...(prod ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (
    PROTECTED.test(p) &&
    !req.cookies.get("better-auth.session_token") &&
    !req.cookies.get("__Secure-better-auth.session_token")
  ) {
    const url = req.nextUrl.clone();
    url.pathname = /^\/(teach|admin)/.test(p) ? "/tutor/login" : "/login";
    url.searchParams.set("next", p);
    return NextResponse.redirect(url);
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|images/).*)"],
};
