import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Opt-in integration test. Creates no emails and deletes its temporary accounts.
async function main() {
  assert.ok(process.argv.includes("--confirm-temporary-users"), "Pass --confirm-temporary-users to authorize temporary hosted test accounts.");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && key && serviceKey, "Supabase configuration is required.");
  const settings = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, serviceKey, settings);
  const publicClient = () => createClient(url, key, settings);
  const accounts: { id: string; email: string; password: string }[] = [];
  const origin = new URL(base).origin;
  async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
    return fetch(`${base}${path}`, {
      method, redirect: "manual", signal: AbortSignal.timeout(120000),
      headers: { Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  assert.equal((await request("/login")).status, 200, "Start the local app before running this test.");
  assert.equal((await request("/api/profile", "PATCH", { full_name: "Test", phone: "" })).status, 401, "Anonymous profile updates must be rejected.");
  const crossOrigin = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Origin: "https://untrusted.example" } });
  assert.equal(crossOrigin.status, 403, "Cross-origin state changes must be rejected.");
  try {
    const run = randomUUID();
    for (const suffix of ["a", "b"]) {
      const email = `cruiseapply-test-${run}-${suffix}@example.com`;
      const password = randomBytes(32).toString("hex");
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Temporary verification account", role: "super_admin" } });
      assert.ok(!error && data.user, "Could not create a temporary verification account.");
      accounts.push({ id: data.user.id, email, password });
    }
    const [applicant, administrator] = accounts;
    const applicantDb = publicClient();
    const login = await applicantDb.auth.signInWithPassword({ email: applicant.email, password: applicant.password });
    assert.ok(!login.error, "Temporary applicant login failed.");
    const profile = await applicantDb.from("profiles").select("role").eq("id", applicant.id).single();
    assert.equal(profile.data?.role, "applicant", "Signup metadata must not grant administrative privileges.");
    const foreign = await applicantDb.from("profiles").select("id").eq("id", administrator.id);
    assert.equal(foreign.data?.length, 0, "RLS must hide another applicant's profile.");
    const anonymous = await publicClient().from("profiles").select("id").eq("id", applicant.id);
    assert.equal(anonymous.data?.length, 0, "Anonymous clients must not see private profiles.");
    const escalation = await applicantDb.from("profiles").update({ role: "admin" }).eq("id", applicant.id);
    assert.ok(escalation.error, "Direct role escalation must be denied by database permissions.");
    async function loginThroughApp(account: typeof applicant, expectedRedirect: string) {
      const response = await request("/api/auth/login", "POST", { email: account.email, password: account.password });
      assert.equal(response.status, 200, "Application login failed.");
      const result = await response.json() as { redirect?: string };
      assert.equal(result.redirect, expectedRedirect, "Login must use the database role for its redirect.");
      const cookies = response.headers.getSetCookie();
      assert.ok(cookies.length > 0 && cookies.every(cookie => cookie.toLowerCase().includes("httponly")), "Session cookies must be HttpOnly.");
      return cookies.map(cookie => cookie.split(";")[0]).join("; ");
    }
    const applicantCookie = await loginThroughApp(applicant, "/dashboard");
    assert.equal((await request("/dashboard", "GET", undefined, applicantCookie)).status, 200, "The authenticated dashboard must load.");
    const forbiddenAdmin = await request("/admin", "GET", undefined, applicantCookie);
    const deniedBody = await forbiddenAdmin.text();
    const redirected = [303, 307].includes(forbiddenAdmin.status) && forbiddenAdmin.headers.get("location")?.includes("/dashboard");
    const streamedRedirect = forbiddenAdmin.status === 200 && /NEXT_REDIRECT;replace;\/dashboard\?access=denied;307/.test(deniedBody);
    assert.ok(redirected || streamedRedirect, "Applicants must be redirected out of administration.");
    assert.ok(!deniedBody.includes("A secure overview of the platform."), "An unauthorized response must not render administrative content.");
    const edit = await request("/api/profile", "PATCH", { full_name: "Updated verification account", phone: "", role: "admin" }, applicantCookie);
    assert.equal(edit.status, 200, "Authorized profile updates must succeed.");
    const updated = await applicantDb.from("profiles").select("role,full_name").eq("id", applicant.id).single();
    assert.equal(updated.data?.role, "applicant", "The profile API must not change roles.");
    assert.equal(updated.data?.full_name, "Updated verification account", "Profile updates must persist.");
    const promotion = await service.from("profiles").update({ role: "admin" }).eq("id", administrator.id);
    assert.ok(!promotion.error, "Could not prepare the temporary administrative test role.");
    const adminCookie = await loginThroughApp(administrator, "/admin");
    assert.equal((await request("/admin", "GET", undefined, adminCookie)).status, 200, "Authorized administration must load.");
    assert.equal((await request("/api/auth/logout", "POST", {}, applicantCookie)).status, 200, "Sign-out must succeed.");
  } finally {
    const ids = accounts.map(account => account.id);
    if (ids.length) {
      // Remove only this test's audit records so their actor foreign keys do not prevent fixture cleanup.
      await service.from("audit_logs").delete().in("actor_id", ids);
      await service.from("audit_logs").delete().eq("target_type", "profiles").in("target_id", ids);
      const failures: string[] = [];
      for (const id of ids) { const { error } = await service.auth.admin.deleteUser(id); if (error) failures.push(id); }
      await service.from("audit_logs").delete().eq("target_type", "profiles").in("target_id", ids);
      assert.equal(failures.length, 0, `Temporary accounts require cleanup: ${failures.join(", ")}`);
    }
  }
  console.log("PASS: authentication, HttpOnly sessions, profile RLS, role escalation defenses, and admin authorization. Temporary accounts cleaned up.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Authentication integration test failed."); process.exitCode = 1; });
