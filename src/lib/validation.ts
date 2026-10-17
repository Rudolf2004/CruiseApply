import { z } from "zod";
export const credentialsSchema = z.object({ email: z.email().max(254), password: z.string().min(12, "Use at least 12 characters.").max(128) });
export const voucherSchema = z.object({ serial: z.string().regex(/^CRV-\d{4}-\d{8}$/), pin: z.string().regex(/^\d{8}$/), jobId: z.uuid() });
export const jobSchema = z.object({
  title: z.string().min(3).max(150), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  company: z.string().trim().min(2).max(150).nullable(), category: z.string().min(2).max(100), department: z.string().min(2).max(100),
  opportunity_type: z.enum(["managed", "research"]).default("research"), service_description: z.string().trim().min(40).max(5000).nullable().default(null),
  location: z.string().min(2).max(150), contract_duration: z.string().min(2).max(100),
  summary: z.string().min(20).max(600), description: z.string().min(40).max(20000),
  responsibilities: z.array(z.string().max(1000)).max(30), requirements: z.array(z.string().max(1000)).max(30),
  preferred_qualifications: z.array(z.string().max(1000)).max(30).default([]),
  salary_text: z.string().max(100).nullable().optional(), application_deadline: z.iso.datetime().nullable().optional(),
  featured: z.boolean(), status: z.enum(["draft", "published", "paused", "closed", "archived"]), sample: z.boolean().default(false)
});
export const applicationSchema = z.object({
  personal: z.object({ first_name: z.string().min(1).max(100), middle_name: z.string().max(100).default(""), surname: z.string().min(1).max(100),
    date_of_birth: z.iso.date(), nationality: z.string().min(2).max(100), country_of_residence: z.string().min(2).max(100),
    email: z.email(), phone: z.string().min(7).max(30), address: z.string().min(5).max(500) }),
  identification: z.object({ passport_available: z.boolean(), passport_number: z.string().max(30).default(""), passport_expiry: z.string().max(10).default("") }),
  education: z.array(z.object({ institution: z.string().min(1).max(200), qualification: z.string().min(1).max(200), field: z.string().max(200), country: z.string().max(100), start_date: z.string().max(10), completion_date: z.string().max(10) })).max(20),
  experience: z.array(z.object({ employer: z.string().min(1).max(200), position: z.string().min(1).max(200), location: z.string().max(200), start_date: z.string().max(10), end_date: z.string().max(10), responsibilities: z.string().max(5000) })).max(30),
  answers: z.record(z.string().max(100), z.string().max(5000)).default({})
});
export type ApplicationData = z.infer<typeof applicationSchema>;
export function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || Array.from(value).some(char => char.charCodeAt(0) <= 32)) return "/dashboard";
  try {
    const url = new URL(value, "https://cruiseapply.invalid");
    return url.origin === "https://cruiseapply.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/dashboard";
  } catch { return "/dashboard"; }
}
