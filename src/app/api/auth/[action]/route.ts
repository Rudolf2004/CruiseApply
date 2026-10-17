import { z } from "zod";
import { database } from "@/lib/supabase/server";
import { appUrl } from "@/lib/config";
import { credentialsSchema } from "@/lib/validation";
import { ApiError, apiError, assertSameOrigin, json, readJson } from "@/lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    assertSameOrigin(request);
    const { action } = await params;
    if (action === "register") throw new ApiError(410,"Applicant registration is closed. Buy a voucher and use Serial Number + PIN.");
    const db = await database();
    if (action === "logout") {
      const { error } = await db.auth.signOut();
      if (error) throw new ApiError(400, "Could not sign out. Please try again.");
      return json({ redirect: "/login" });
    }
    const input = await readJson(request);
    if (action === "login") {
      const values = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }).parse(input);
      const { data, error } = await db.auth.signInWithPassword(values);
      if (error || !data.user) throw new ApiError(400, "Check your email and password. If you just registered, confirm your email first.");
      const { data: profile } = await db.from("profiles").select("role").eq("id", data.user.id).single();
      return json({ redirect: profile && ["admin", "super_admin"].includes(profile.role) ? "/admin" : "/dashboard" });
    }
    if (action === "forgot-password") {
      const { email } = z.object({ email: z.email().max(254) }).parse(input);
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/auth/callback?next=/reset-password` });
      if (error?.status === 429) throw new ApiError(429, "Please wait before requesting another reset email.");
      if (error) throw new ApiError(503, "Password recovery is temporarily unavailable. Please try again later.");
      return json({ message: "If an account exists for that email, you will receive a password-reset link." });
    }
    if (action === "reset-password") {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new ApiError(401, "This reset link has expired. Please request a new one.");
      const { password } = credentialsSchema.pick({ password: true }).parse(input);
      const { error } = await db.auth.updateUser({ password });
      if (error) throw new ApiError(400, "Could not update your password. Use a different password or request a new reset link.");
      return json({ message: "Your password has been updated. You can return to your dashboard." });
    }
    throw new ApiError(404, "This action is not available.");
  } catch (error) { return apiError(error); }
}
