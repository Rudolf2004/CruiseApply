import "server-only";
import { z } from "zod";
import { serviceDatabase } from "@/lib/supabase/server";
import { ApiError } from "@/lib/http";
import { ApplicantAuthError, assertApplicantRollout, tokenDigest, validToken } from "@/features/applicant-auth/policy";
import { draftSchema, revisionSchema, submissionSchema } from "@/features/applications/schema";
import { portalSchema } from "./schema";

export async function portalRpc(raw: string | null, name: string, args: Record<string, unknown> = {}) {
  assertApplicantRollout();
  if (!raw || !validToken(raw)) throw new ApplicantAuthError(401);
  // Name/args are chosen only by server code. A browser never supplies an RPC name or proof hash.
  const result = await serviceDatabase().rpc(name, { ...args, p_token_hash: tokenDigest(raw) });
  if (result.error) {
    if (result.error.code === "28000") throw new ApplicantAuthError(401);
    if (result.error.code === "P0001") {
      const message = result.error.message.includes("Revision conflict") ? "Your application changed. Reload before editing; keep a copy of unsaved changes." :
        result.error.message.includes("read only") ? "This application is read-only." : "This action is unavailable for your voucher or application. Reload and try again.";
      throw new ApiError(409, message);
    }
    throw new ApiError(503, "The applicant portal is temporarily unavailable. Please retry.");
  }
  return result.data;
}
export async function loadPortal(raw: string | null, page = 1) {
  z.number().int().min(1).max(10000).parse(page);
  return portalSchema.parse(await portalRpc(raw, "load_voucher_portal", { p_notifications_page: page }));
}
export async function loadPortalPageData(raw: string | null, page: number, chooseOpportunity: boolean) {
  const data = await loadPortal(raw, page);
  const checkedAt = new Date();
  const canRedeem = data.voucher.status === "unused" && Date.parse(data.voucher.expires_at) > checkedAt.getTime() && data.payment.status === "successful";
  let opportunities: {id:string;title:string}[] = [];
  if (chooseOpportunity && !data.application && canRedeem) {
    let query = serviceDatabase().from("jobs").select("id,title").eq("status","published").eq("sample",false).eq("opportunity_type","managed")
      .or(`application_deadline.is.null,application_deadline.gt.${checkedAt.toISOString()}`).order("title").limit(100);
    if (data.voucher.job_id) query = query.eq("id",data.voucher.job_id);
    const result = await query;
    if (result.error) throw new ApiError(503,"Opportunities unavailable.");
    opportunities = result.data ?? [];
  }
  return { data,canRedeem,opportunities };
}
export async function savePortal(raw: string | null, id: string, input: unknown) {
  z.uuid().parse(id);
  const { revision, draft } = z.object({ revision: revisionSchema, draft: draftSchema }).strict().parse(input);
  return portalRpc(raw, "save_portal_application", { p_application_id: id, p_revision: revision, p_data: draft });
}
export async function submitPortal(raw: string | null, id: string, input: unknown) {
  z.uuid().parse(id);
  const { revision, declaration } = z.object({ revision: revisionSchema, declaration: z.literal(true) }).strict().parse(input);
  const { application } = await loadPortal(raw);
  if (!application || application.id !== id) throw new ApiError(404, "Application not found.");
  if (!application.submitted_at) {
    if (revision !== application.revision) throw new ApiError(409, "Your application changed. Reload and review before submitting.");
    submissionSchema(application.job.questions, application.job.minimum_age).parse(application.draft);
  }
  return portalRpc(raw, "submit_portal_application", { p_application_id: id, p_revision: revision, p_declaration: declaration });
}
