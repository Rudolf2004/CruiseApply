import { z } from "zod";
import { revisionSchema } from "@/features/applications/schema";
export const responseDocumentSchema=z.object({id:z.uuid(),name:z.string().min(1).max(200).regex(/^[^\\/\x00-\x1f\x7f]+$/),mime:z.enum(["application/pdf","image/png","image/jpeg"]),size:z.number().int().min(1).max(10485760)}).strict();
export const responseSchema=z.object({requestId:z.uuid(),revision:revisionSchema,body:z.string().trim().min(10).max(4000),documents:z.array(responseDocumentSchema).max(5)}).strict().refine(v=>new Set(v.documents.map(d=>d.id)).size===v.documents.length,"Duplicate attachment");
export const withdrawalSchema=z.object({requestId:z.uuid(),revision:revisionSchema,reason:z.string().trim().min(10).max(4000),confirmed:z.literal(true)}).strict();
export const responsesSchema=z.object({total:z.number().int().nonnegative(),items:z.array(z.object({request_id:z.uuid(),operation:z.enum(["response","withdraw"]),body:z.string(),created_at:z.string(),documents:z.array(responseDocumentSchema)}))});
export type ResponseDocument=z.infer<typeof responseDocumentSchema>;
export type Responses=z.infer<typeof responsesSchema>;
