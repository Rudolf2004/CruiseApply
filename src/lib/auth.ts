import "server-only";
import { redirect } from "next/navigation";
import { database } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/config";
export async function requireUser(admin = false) {
  if (!hasSupabase) redirect("/login?setup=required");
  const db = await database();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("id,full_name,phone,role").eq("id", user.id).single();
  if (!profile) throw new Error("Your profile is unavailable. Please contact support.");
  if (admin && !["admin", "super_admin"].includes(profile.role)) redirect("/dashboard?access=denied");
  return { user, profile, db };
}
