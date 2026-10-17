import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { hasSupabase, supabasePublicKey } from "@/lib/config";
export async function database() {
  if (!hasSupabase) throw new Error("Supabase is not configured. Follow README setup instructions.");
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabasePublicKey!, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    cookies: { getAll: () => jar.getAll(), setAll: (values) => {
      try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); }
      catch { /* Server Components cannot write cookies; proxy refreshes the session. */ }
    } }
  });
}
export function serviceDatabase() {
  if (!hasSupabase || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Server database credentials are not configured.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
