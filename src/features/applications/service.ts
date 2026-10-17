import "server-only";
import { requireUser } from "@/lib/auth";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { draftSchema, emptyDraft, questionSchema, revisionSchema, submissionSchema } from "./schema";

export function workflowError(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.message.includes("Revision conflict")) throw new ApiError(409, "This application changed in another request. Reload before editing further; keep a copy of unsaved changes.");
  if (error.code === "P0001") throw new ApiError(409, error.message);
  throw new Error("Application operation unavailable.");
}
export async function loadApplication(ownerId: string, id: string) { return loadOwnedApplication(ownerId, id, "user_id"); }
export async function loadStaffApplication(id: string) {
  await requireUser(true); z.uuid().parse(id);
  const owner = await serviceDatabase().from("applications").select("user_id,applicant_id").eq("id",id).maybeSingle();
  if (owner.error) throw new Error("Candidate lookup unavailable.");
  if (!owner.data) throw new ApiError(404,"Application not found.");
  return loadOwnedApplication(owner.data.user_id ?? owner.data.applicant_id, id, owner.data.user_id ? "user_id" : "applicant_id");
}
async function loadOwnedApplication(ownerId: string, id: string, ownerColumn: "user_id" | "applicant_id") {
  z.uuid().parse(id); z.uuid().parse(ownerId); const db = serviceDatabase();
  const row = await db.from("applications").select("id,reference,status,personal,identification,revision,updated_at,submitted_at,job_id,opportunity_title_snapshot,service_description_snapshot")
    .eq("id", id).eq(ownerColumn, ownerId).maybeSingle();
  if (row.error) throw new Error("Application unavailable. Check the application workflow migration.");
  if (!row.data) throw new ApiError(404, "Application not found.");
  const [education, experience, answers, documents, job, history] = await Promise.all([
    db.from("application_education").select("institution,qualification,field,country,start_date,completion_date").eq("application_id", id).order("sort_order").order("id"),
    db.from("application_experience").select("employer,position,location,start_date,end_date,responsibilities").eq("application_id", id).order("sort_order").order("id"),
    db.from("application_answers").select("question_id,answer").eq("application_id", id),
    db.from("application_documents").select("id,kind,name,size_bytes").eq("application_id", id).eq(ownerColumn, ownerId).order("created_at"),
    db.from("jobs").select("title,company,service_description,questions,minimum_age,required_documents,status,application_deadline").eq("id", row.data.job_id).single(),
    db.from("application_status_history").select("status,message,created_at").eq("application_id", id).order("created_at"),
  ]);
  if ([education, experience, answers, documents, job, history].some(result => result.error)) throw new Error("Application details unavailable.");
  const normalize = (rows: Record<string, unknown>[]) => rows.map(record => Object.fromEntries(Object.entries(record).map(([key,value]) => [key,value ?? ""])));
  const draft = draftSchema.parse({ personal: { ...emptyDraft.personal, ...row.data.personal }, identification: { ...emptyDraft.identification, ...row.data.identification },
    education: normalize(education.data!), experience: normalize(experience.data!), answers: Object.fromEntries(answers.data!.map(a => [a.question_id, a.answer])) });
  return { ...row.data, draft, documents: documents.data!, job: { ...job.data!, questions: questionSchema.parse(job.data!.questions) }, history: history.data! };
}
export async function saveDraft(ownerId: string, id: string, input: unknown) {
  z.uuid().parse(id);
  const { revision, draft } = z.object({ revision: revisionSchema, draft: draftSchema }).parse(input);
  const result = await serviceDatabase().rpc("save_application_draft", { p_user_id: ownerId, p_application_id: id, p_revision: revision, p_data: draft });
  workflowError(result.error); return result.data;
}
export async function submitApplication(ownerId: string, id: string, input: unknown) {
  const { revision, declaration } = z.object({ revision: revisionSchema, declaration: z.literal(true) }).parse(input);
  const application = await loadApplication(ownerId, id);
  if (!application.submitted_at) {
    if (application.revision !== revision) throw new ApiError(409, "Your application has changed. Reload and review it before submitting.");
    submissionSchema(application.job.questions, application.job.minimum_age).parse(application.draft);
  }
  const result = await serviceDatabase().rpc("submit_application", { p_user_id: ownerId, p_application_id: id, p_revision: revision, p_declaration: declaration });
  workflowError(result.error); return result.data;
}
