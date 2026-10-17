import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Voucher auth has an independent, disabled-by-default server boundary.
  // Never refresh or issue staff/legacy Supabase cookies on these endpoints.
  if (request.nextUrl.pathname.startsWith("/api/guest-checkout/") || request.nextUrl.pathname.startsWith("/api/applicant-auth/") || request.nextUrl.pathname.startsWith("/api/applicant-portal") || request.nextUrl.pathname === "/applicant" || request.nextUrl.pathname.startsWith("/applicant/")) return response;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const db = createServerClient(url, key, { cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }, cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(values) {
      values.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    }
  } });
  await db.auth.getUser();
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp)$).*)"] };
