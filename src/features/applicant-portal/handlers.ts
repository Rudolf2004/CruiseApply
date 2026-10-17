import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, readBody, readJson } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { ApplicantAuthError, applicantToken, assertApplicantOrigin, assertApplicantRollout, tokenDigest } from "@/features/applicant-auth/policy";
import { resolveApplicantSession } from "@/features/applicant-auth/service";
import { failure, setSession } from "@/features/applicant-auth/handlers";
import { documentKind, revisionSchema } from "@/features/applications/schema";
import { maxDocumentBytes, validateDocument } from "@/features/applications/files";
import { loadPortal, portalRpc, savePortal, submitPortal } from "./service";

const secureHeaders = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
function readBoundary(request: Request) {
  assertApplicantRollout();
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApplicantAuthError(403);
  if (request.headers.has("origin")) assertApplicantOrigin(request);
}
export async function portalHandler(request: Request, action: (raw: string) => Promise<unknown | Response>) {
  try {
    if (request.method === "GET") readBoundary(request); else assertApplicantOrigin(request);
    const raw = applicantToken(request);
    const scope = await resolveApplicantSession(raw); // authenticated before any body/storage work
    const limit = await serviceDatabase().rpc("consume_request_limit", { p_key: `portal:${scope.voucher_access_id}`, p_limit: 240, p_seconds: 60 });
    if (limit.error) throw new ApiError(503, "Please retry shortly.");
    if (!limit.data) throw new ApplicantAuthError(429);
    if (request.method === "POST" && new URL(request.url).pathname.endsWith("/documents")) {
      const uploadLimit = await serviceDatabase().rpc("consume_request_limit", { p_key: `portal-upload:${scope.voucher_access_id}`, p_limit: 20, p_seconds: 600 });
      if (uploadLimit.error) throw new ApiError(503, "Please retry shortly.");
      if (!uploadLimit.data) throw new ApplicantAuthError(429);
    }
    const result = await action(raw!);
    const fresh = await resolveApplicantSession(raw); // includes recheck before streaming bytes
    const response = result instanceof Response ? new NextResponse(result.body, { status: result.status, headers: result.headers }) : NextResponse.json(result);
    for (const [key,value] of Object.entries(secureHeaders)) response.headers.set(key,value);
    setSession(response,raw!,fresh);
    return response;
  } catch (error) {
    if (error instanceof ApplicantAuthError) return failure(error,true);
    const status = error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : 503;
    const message = error instanceof ApiError ? error.message : status === 400 ? "Check the submitted fields and try again." : "The portal is temporarily unavailable. Please retry.";
    return NextResponse.json({ error: message }, { status, headers: secureHeaders });
  }
}
export const portalLoad = (request: Request) => portalHandler(request, raw => loadPortal(raw, Number(new URL(request.url).searchParams.get("page") ?? 1)));
export const portalSave = (request: Request, id: string) => portalHandler(request, async raw => savePortal(raw,id,await readJson(request)));
export const portalSubmit = (request: Request, id: string) => portalHandler(request, async raw => submitPortal(raw,id,await readJson(request)));
export const portalRedeem = (request: Request) => portalHandler(request, async raw => {
  const { jobId } = z.object({ jobId: z.uuid() }).strict().parse(await readJson(request));
  return { applicationId: await portalRpc(raw,"redeem_portal_voucher",{p_job_id:jobId}) };
});
export const portalReadNotification = (request: Request, id: string) => portalHandler(request, raw => portalRpc(raw,"read_portal_notification",{p_notification_id:z.uuid().parse(id)}));
export const portalUpload = (request: Request, id: string) => portalHandler(request, async raw => {
  z.uuid().parse(id); const query = new URL(request.url).searchParams;
  const revision = revisionSchema.parse(Number(query.get("revision") ?? NaN)),kind=documentKind.parse(query.get("kind")),name=query.get("name")??"",mime=request.headers.get("content-type")??"";
  const documentId=randomUUID();
  const path=z.string().parse(await portalRpc(raw,"portal_upload_context",{p_application_id:id,p_revision:revision,p_document_id:documentId}));
  const bytes=await readBody(request,maxDocumentBytes);
  try { validateDocument(bytes,name,mime); } catch { throw new ApiError(400,"Choose a valid PDF, JPEG or PNG up to 10 MB with a valid filename."); }
  const db=serviceDatabase(),bucket=db.storage.from("application-documents");
  if ((await bucket.upload(path,bytes,{contentType:mime,upsert:false})).error) throw new ApiError(503,"Upload unavailable. Please retry.");
  // Retain ambiguous transport-failure objects: a registration may have committed.
  const result=await db.rpc("register_portal_document",{p_token_hash:tokenDigest(raw),p_application_id:id,p_revision:revision,p_document_id:documentId,p_kind:kind,p_name:name,p_mime:mime,p_size:bytes.length});
  if(result.error){
    if(["P0001","28000"].includes(result.error.code)) {
      const registered=await db.from("application_documents").select("id").eq("id",documentId).eq("application_id",id).maybeSingle();
      if(!registered.error&&!registered.data)await bucket.remove([path]);
    }
    if(result.error.code==="28000")throw new ApplicantAuthError(401);
    throw new ApiError(result.error.code==="P0001"?409:503,"Upload could not be registered. Reload the application before retrying.");
  }
  return {revision:result.data.revision,updatedAt:result.data.updatedAt,document:{id:documentId,kind,name,size_bytes:bytes.length}};
});
export const portalDownload = (request: Request, id: string, documentId: string) => portalHandler(request, async raw => {
  const args={p_application_id:z.uuid().parse(id),p_document_id:z.uuid().parse(documentId)};
  const document=z.object({storage_path:z.string(),name:z.string(),mime_type:z.enum(["application/pdf","image/jpeg","image/png"])}).parse(await portalRpc(raw,"authorize_portal_document",args));
  const file=await serviceDatabase().storage.from("application-documents").download(document.storage_path);
  if(file.error)throw new ApiError(503,"Document download unavailable.");
  await portalRpc(raw,"authorize_portal_document",args);
  return new Response(file.data,{headers:{"Content-Type":document.mime_type,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,"Content-Security-Policy":"sandbox"}});
});
export const portalRemove = (request: Request, id: string, documentId: string) => portalHandler(request, async raw => {
  const {revision}=z.object({revision:revisionSchema}).strict().parse(await readJson(request));
  const result=await portalRpc(raw,"remove_portal_document",{p_application_id:z.uuid().parse(id),p_document_id:z.uuid().parse(documentId),p_revision:revision});
  if((await serviceDatabase().storage.from("application-documents").remove([result.storagePath])).error)console.error("Private document cleanup requires retry",{documentId});
  return {revision:result.revision,updatedAt:result.updatedAt};
});
