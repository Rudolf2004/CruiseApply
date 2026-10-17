import {z} from "zod";
const id=z.uuid(),revision=z.number().int().min(0).max(2147483646),message=z.string().trim().min(10).max(2000);
const https=z.url().max(2000).refine(v=>{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password;},"Use an HTTPS URL without credentials.");
const base={id,revision};
export const matchingCommandSchema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("employer_save"),requestId:id,data:z.object({...base,name:z.string().trim().min(2).max(200),website:https}).strict()}).strict(),
 z.object({operation:z.literal("opportunity_save"),requestId:id,data:z.object({...base,employerId:id,title:z.string().trim().min(2).max(200),sourceUrl:https,checkedAt:z.iso.datetime().nullable(),status:z.enum(["research","verified","closed"]),authorized:z.boolean(),evidence:z.string().max(2000),recipient:z.union([z.email().max(254),z.literal("")])}).strict().refine(d=>!d.authorized||(d.evidence.trim().length>=10&&!!d.recipient),"Authorization evidence and a recipient are required.").refine(d=>d.status!=="verified"||!!d.checkedAt,"A source check date is required.")}).strict(),
 z.object({operation:z.literal("match_create"),requestId:id,data:z.object({...base,applicationId:id,opportunityId:id,message}).strict()}).strict(),
 z.object({operation:z.literal("match_status"),requestId:id,data:z.object({...base,status:z.enum(["qualified","shortlisted","closed"]),message}).strict()}).strict(),
 z.object({operation:z.literal("consent_request"),requestId:id,data:z.object({...base,message,documentIds:z.array(id).max(20).refine(v=>new Set(v).size===v.length)}).strict()}).strict(),
 z.object({operation:z.literal("referral_record"),requestId:id,data:z.object({...base,message,evidence:z.string().trim().min(10).max(2000)}).strict()}).strict(),
]);
export const consentSchema=z.object({requestId:id,matchId:id,revision,choice:z.enum(["granted","declined","revoked"]),confirmed:z.literal(true)}).strict();
export const employerSchema=z.object({id,name:z.string(),website:z.string().nullable(),revision});
export const opportunitySchema=z.object({id,employer_id:id,title:z.string(),source_url:z.string(),source_checked_at:z.string().nullable(),status:z.enum(["research","verified","closed"]),referral_authorized:z.boolean(),authorization_evidence:z.string().nullable(),recipient_email:z.string().nullable(),revision});
export const matchSchema=z.object({id,employer_opportunity_id:id,status:z.string(),revision,consent_state:z.string()});
export const portalMatchesSchema=z.array(z.object({id,revision,status:z.string(),consentState:z.enum(["pending","granted","declined","revoked"]),scope:z.object({employer:z.string(),website:z.string().nullable(),title:z.string(),recipient:z.string(),sourceUrl:z.string(),profileFields:z.array(z.string()),documents:z.array(z.object({id,name:z.string()}))})}));
export type Employer=z.infer<typeof employerSchema>;export type EmployerOpportunity=z.infer<typeof opportunitySchema>;export type CandidateMatch=z.infer<typeof matchSchema>;
