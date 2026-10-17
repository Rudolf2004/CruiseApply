import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
assert.ok(process.argv.includes("--drafts-only"),"Only draft imports are supported.");
const reviewed = JSON.parse(await readFile("supabase/configuration/researched-vacancies.json","utf8"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession: false,autoRefreshToken: false } });
for (const job of reviewed.jobs) {
  const { source,...fields } = job;
  assert.equal(new URL(source).hostname,"shipjobs.carnival.com");
  const existing = await db.from("jobs").select("id,status").eq("slug",job.slug).maybeSingle();
  assert.ok(!existing.error);
  if (existing.data) { console.log(`Existing listing preserved: ${job.slug} (${existing.data.status})`); continue; }
  const result = await db.from("jobs").insert({ ...fields,company: "Carnival Cruise Line",status: "draft",sample: false,featured: false,
    location: "Shipboard; vessel assignment not specified",contract_duration: "Not specified by employer",salary_text: null,currency: null,application_deadline: null,
    description: `${job.summary}\n\nIndependent summary of the employer's listing, checked ${reviewed.checked_on}. Full details and application: ${source}\n\nCruiseApply is not an authorized representative of Carnival. Carnival and its authorized partners do not charge recruitment or deployment fees. This draft must not be published into a mandatory paid application flow. Salary, contract length and closing date were not specified in the reviewed listing. Eligibility and continued availability must be confirmed on the employer's website.`,
    questions: [],required_documents: []
  }).select("id,title,status").single();
  assert.ok(!result.error && result.data,`Draft import failed: ${job.slug}`);
  console.log(`Added draft: ${result.data.title}`);
}
const check = await db.from("jobs").select("title,status,sample").in("slug",reviewed.jobs.map((j: { slug: string }) => j.slug));
assert.ok(!check.error && check.data?.length === 4);
assert.ok(check.data.every(j => j.status === "draft" && j.sample === false));
console.log("PASS: four researched employer listings stored as non-public drafts. No payment, voucher or application mutations.");
