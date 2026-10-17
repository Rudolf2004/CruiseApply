import { z } from "zod";
import { draftSchema, emptyDraft, questionSchema } from "@/features/applications/schema";
const date = z.string();
const document = z.object({ id: z.uuid(), kind: z.string(), name: z.string(), size_bytes: z.number().int() });
const application = z.object({
  id: z.uuid(), reference: z.string(), status: z.string(), revision: z.number().int(),
  personal: z.record(z.string(), z.unknown()), identification: z.record(z.string(), z.unknown()),
  job_id: z.uuid(), updated_at: date, submitted_at: date.nullable(), declaration_at: date.nullable(),
  opportunity_title_snapshot: z.string().nullable(), service_description_snapshot: z.string().nullable(),
  education: z.array(z.record(z.string(), z.unknown())), experience: z.array(z.record(z.string(), z.unknown())),
  answers: z.record(z.string(), z.string()), documents: z.array(document),
  history: z.array(z.object({ status: z.string(), message: z.string().nullable(), created_at: date })),
  job: z.object({ title: z.string(), company: z.string().nullable(), service_description: z.string().nullable(),
    questions: questionSchema, minimum_age: z.number().nullable(), required_documents: z.array(z.string()), status: z.string(), application_deadline: date.nullable() }),
}).transform(({ personal, identification, education, experience, answers, ...row }) => {
  const normalize = (rows: Record<string, unknown>[]) => rows.map(item => Object.fromEntries(Object.entries(item).map(([k,v]) => [k,v ?? ""])));
  return { ...row, draft: draftSchema.parse({ personal: { ...emptyDraft.personal,...personal }, identification: { ...emptyDraft.identification,...identification }, education: normalize(education), experience: normalize(experience), answers }) };
});
// Strip unknown fields so a future SQL expansion cannot leak internal material.
export const portalSchema = z.object({
  voucher: z.object({ id: z.uuid(), serial: z.string(), status: z.string(), expires_at: date, job_id: z.uuid().nullable() }),
  payment: z.object({ id: z.uuid(), reference: z.string(), status: z.string(), amount: z.number().int(), currency: z.string(), paid_at: date.nullable(),
    provider: z.string(), provider_id: z.string().nullable(), created_at: date, charge_amount: z.number().int(), charge_currency: z.string(),
    display_minor_units: z.number().int().min(0).max(4).nullable().optional(), display_amount: z.number().nullable(), display_currency: z.string().nullable(), country_code: z.string().nullable(),
    exchange_rate: z.number().nullable(), exchange_rate_source: z.string().nullable(), exchange_rate_as_of: date.nullable() }),
  product: z.object({ name: z.string(), validity_days: z.number().int() }),
  application: application.nullable(),
  notifications: z.array(z.object({ id: z.uuid(), title: z.string(), body: z.string(), read_at: date.nullable(), created_at: date, application_id: z.uuid().nullable() })),
  unread_count: z.number().int(),
});
export type PortalData = z.infer<typeof portalSchema>;
