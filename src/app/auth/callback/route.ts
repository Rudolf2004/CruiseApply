import { NextResponse } from "next/server";
import { database } from "@/lib/supabase/server";
import { appUrl } from "@/lib/config";
import { safeNext } from "@/lib/validation";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const db = await database();
    const { data, error } = await db.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      let next = safeNext(url.searchParams.get("next"));
      if (next === "/dashboard") {
        const { data: profile } = await db.from("profiles").select("role").eq("id", data.user.id).single();
        if (profile && ["admin", "super_admin"].includes(profile.role)) next = "/admin";
      }
      return NextResponse.redirect(new URL(next, appUrl));
    }
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", appUrl));
}
