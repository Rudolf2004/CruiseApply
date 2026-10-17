// Exact initial category approved by the owner. No employer or extra criteria.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { applicationServiceDescription } from "../src/features/jobs/service-description.ts";
assert.ok(process.argv.includes("--approved-initial-intake"));
assert.ok(process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession: false,autoRefreshToken: false } });
const slug = "hospitality-guest-services-candidate-screening";
const existing = await db.from("jobs").select("id,status,opportunity_type").eq("slug",slug).maybeSingle();
assert.ok(!existing.error,"Migration 0005 must be applied.");
if (!existing.data) {
  const result = await db.from("jobs").insert({
    title: "Hospitality & Guest Services — Candidate Screening",slug,company: null,opportunity_type: "managed",
    category: "Hospitality & Guest Services",department: "Candidate Screening",
    summary: "Apply to CruiseApply for candidate review and screening in hospitality and guest services. Employer matching is a later step, not a guaranteed outcome.",
    description: "CruiseApply manages this candidate-intake category. Submit your profile for review and screening; qualified or shortlisted candidates may be contacted for potential employer matching or referral. This is not a vacancy from a cruise company and no employer is assigned at intake.",
    service_description: applicationServiceDescription, status: "published",sample: false,featured: true,
    location: "CruiseApply candidate intake",contract_duration: "Not applicable at intake; no contract offered",
    salary_text: null,currency: null,openings: null,minimum_age: null,application_deadline: null,
    responsibilities: [],requirements: [],preferred_qualifications: [],questions: [],required_documents: [],
  }).select("id").single(); assert.ok(!result.error && result.data,"Managed category creation failed.");
}
const check = await db.from("jobs").select("id,title,company,opportunity_type,status,required_documents,questions,salary_text,openings,minimum_age").eq("slug",slug).single();
assert.ok(!check.error && check.data); assert.equal(check.data.company,null); assert.equal(check.data.status,"published");
assert.deepEqual(check.data.required_documents,[]); assert.deepEqual(check.data.questions,[]);
assert.equal(check.data.opportunity_type,"managed");
console.log("PASS: approved managed intake configured, employer unassigned, no mandatory documents/questions or invented compensation/openings.");
