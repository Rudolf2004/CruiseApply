import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession: false,autoRefreshToken: false } });
const users = await db.auth.admin.listUsers({ page: 1,perPage: 1000 });
assert.ok(!users.error,users.error?.message);
const fixtures = users.data.users.filter(user => /^cruiseapply-review-[0-9a-f-]{36}@example\.com$/.test(user.email || ""));
console.log({ reviewFixtures: fixtures.length });
for (const user of fixtures) {
  for (const table of ["applications","payments","vouchers"]) {
    const result = await db.from(table).select("id",{ count: "exact",head: true }).eq("user_id",user.id);
    assert.ok(!result.error,result.error?.message); assert.equal(result.count,0,"Refusing to remove an account with business records.");
  }
  for (const column of ["actor_id","target_id"]) {
    const result = await db.from("audit_logs").delete().eq(column,user.id);
    assert.ok(!result.error,result.error?.message);
  }
  const result = await db.auth.admin.deleteUser(user.id);
  console.log({ fixtureId: user.id,deleted: !result.error,error: result.error ? { message: result.error.message,code: result.error.code,status: result.error.status } : null });
  assert.ok(!result.error,result.error?.message);
  const cleanup = await db.from("audit_logs").delete().eq("target_id",user.id);
  assert.ok(!cleanup.error,cleanup.error?.message);
}
