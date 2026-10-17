import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const state = JSON.parse(await readFile("test-results/checkout-e2e-state.json","utf8"));
const options = { auth: { persistSession: false,autoRefreshToken: false } };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,options);
const publicClient = createClient(url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,options);
for (const [table,column] of [["applications","revision"],["application_education","sort_order"],["application_experience","sort_order"],["jobs","required_documents"]]) {
  assert.ok(!(await service.from(table).select(column).limit(1)).error,`Missing migration column ${table}.${column}`);
}
for (const [table,columns] of [["jobs","company,opportunity_type,service_description,source_url,source_checked_at"],["applications","opportunity_title_snapshot,service_description_snapshot"],["employers","id"],["employer_opportunities","id"],["application_matches","id"]]) {
  assert.ok(!(await service.from(table).select(columns).limit(1)).error,`Migration 0005 schema missing: ${table}`);
}
const research = await service.from("jobs").select("status,opportunity_type").in("slug",["carnival-2nd-engineer-22","carnival-2nd-eto-534","carnival-public-health-officer-99","carnival-commis-team-dining-186"]);
assert.ok(!research.error && research.data?.length === 4);
assert.ok(research.data.every(row => row.status === "draft" && row.opportunity_type === "research"));
const id = randomUUID();
assert.equal((await service.from("applications").select("id").eq("id",id)).data?.length,0);
const common = { p_user_id: state.id,p_application_id: id,p_revision: 0 };
const operations = [
  ["save_application_draft",{ ...common,p_data: {} }],
  ["register_application_document",{ ...common,p_id: randomUUID(),p_kind: "cv",p_name: "test.pdf",p_path: "invalid",p_mime: "application/pdf",p_size: 10 }],
  ["remove_application_document",{ ...common,p_document_id: randomUUID() }],
  ["submit_application",{ ...common,p_declaration: true }],
] as const;
for (const [name,args] of operations) {
  const denied = await publicClient.rpc(name,args);
  assert.equal(denied.error?.code,"42501",`${name}: anonymous execute must be denied`);
  const result = await service.rpc(name,args);
  assert.equal(result.error?.code,"P0001",`${name}: service operation must exist`);
  assert.equal(result.error?.message,"Application unavailable",`${name}: absent application must reject`);
}
assert.ok(!(await publicClient.auth.signInWithPassword({ email: state.email,password: state.password })).error);
try {
  for (const table of ["employers","employer_opportunities","application_matches"]) {
    const result = await publicClient.from(table).select("id"); assert.ok(!result.error); assert.deepEqual(result.data,[],"Applicant must not read internal matching records.");
  }
  for (const [name,args] of operations) assert.equal((await publicClient.rpc(name,args)).error?.code,"42501",`${name}: applicant execute must be denied`);
  const bucket = await service.storage.getBucket("application-documents");
  assert.ok(!bucket.error); assert.equal(bucket.data?.public,false);
  console.log("PASS: all four migration columns, four service-only RPCs, anonymous/applicant execute denial, absent-application rejection, private bucket. No records changed.");
} finally { await publicClient.auth.signOut({ scope: "local" }); }
