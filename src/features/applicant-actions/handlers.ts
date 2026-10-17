import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, readBody, readJson } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { portalHandler } from "@/features/applicant-portal/handlers";
import { portalRpc } from "@/features/applicant-portal/service";
import { maxDocumentBytes,validateDocument } from "@/features/applications/files";
import { responseSchema,withdrawalSchema,responsesSchema,responseDocumentSchema } from "./schema";
export const submitResponse=(request:Request,id:string)=>portalHandler(request,async raw=>{
  z.uuid().parse(id);const input=responseSchema.parse(await readJson(request));
  return portalRpc(raw,"submit_portal_response",{p_application_id:id,p_revision:input.revision,p_request_id:input.requestId,p_body:input.body,p_documents:input.documents});
});
export const withdrawApplication=(request:Request,id:string)=>portalHandler(request,async raw=>{
  z.uuid().parse(id);const input=withdrawalSchema.parse(await readJson(request));
  return portalRpc(raw,"withdraw_portal_application",{p_application_id:id,p_revision:input.revision,p_request_id:input.requestId,p_reason:input.reason});
});
export const listResponses=(request:Request,id:string)=>portalHandler(request,async raw=>{
  z.uuid().parse(id);const page=z.coerce.number().int().min(1).max(10000).parse(new URL(request.url).searchParams.get("page")??1);
  return responsesSchema.parse(await portalRpc(raw,"load_portal_responses",{p_application_id:id,p_page:page}));
});
export const uploadResponse=(request:Request,id:string)=>portalHandler(request,async raw=>{
  z.uuid().parse(id);const query=new URL(request.url).searchParams;
  const requestId=z.uuid().parse(query.get("requestId")),revision=z.coerce.number().int().min(0).parse(query.get("revision")??NaN);
  const documentId=randomUUID(),mime=request.headers.get("content-type")??"",name=query.get("name")??"";
  const args={p_application_id:id,p_revision:revision,p_request_id:requestId,p_document_id:documentId};
  const path=z.string().parse(await portalRpc(raw,"portal_response_upload_context",args));
  const bytes=await readBody(request,maxDocumentBytes);
  try{validateDocument(bytes,name,mime);}catch{throw new ApiError(400,"Choose a valid PDF, JPEG or PNG up to 10 MB.");}
  const bucket=serviceDatabase().storage.from("application-documents");
  if((await bucket.upload(path,bytes,{contentType:mime,upsert:false})).error)throw new ApiError(503,"Upload unavailable. Please retry.");
  // Recheck before returning. Unregistered objects are private and never downloaded
  // by this API. Cleanup is safe here: this generated ID has not left the server.
  try{await portalRpc(raw,"portal_response_upload_context",args);}catch(error){await bucket.remove([path]);throw error;}
  return responseDocumentSchema.parse({id:documentId,name,mime,size:bytes.length});
});
