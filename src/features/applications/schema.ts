import { z } from "zod";
import { applicationSchema } from "@/lib/validation";
const text = (max: number) => z.string().max(max);
const date = z.union([z.literal(""), z.iso.date()]);
const education = z.object({ institution: text(200), qualification: text(200), field: text(200), country: text(100), start_date: date, completion_date: date })
  .refine(v => !v.start_date || !v.completion_date || v.completion_date >= v.start_date, "Completion date must follow start date.");
const experience = z.object({ employer: text(200), position: text(200), location: text(200), start_date: date, end_date: date, responsibilities: text(5000) })
  .refine(v => !v.start_date || !v.end_date || v.end_date >= v.start_date, "End date must follow start date.");
export const draftSchema = z.object({
  personal: z.object({ first_name: text(100), middle_name: text(100), surname: text(100), date_of_birth: date, nationality: text(100), country_of_residence: text(100), email: text(254), phone: text(30), address: text(500) }),
  identification: z.object({ passport_available: z.boolean(), passport_number: text(30), passport_expiry: date }),
  education: z.array(education).max(20), experience: z.array(experience).max(30),
  answers: z.record(z.string().min(1).max(100), text(5000)).refine(v => Object.keys(v).length <= 50, "Too many answers."),
});
export type Draft = z.infer<typeof draftSchema>;
export const emptyDraft: Draft = {
  personal: { first_name: "", middle_name: "", surname: "", date_of_birth: "", nationality: "", country_of_residence: "", email: "", phone: "", address: "" },
  identification: { passport_available: false, passport_number: "", passport_expiry: "" }, education: [], experience: [], answers: {},
};
export const questionSchema = z.array(z.object({ id: z.string().min(1).max(100), label: z.string().min(1).max(500), required: z.boolean().default(false) })).max(50)
  .refine(q => new Set(q.map(item => item.id)).size === q.length, "Duplicate question IDs.");
export type Question = z.infer<typeof questionSchema>[number];
export const documentKind = z.enum(["cv", "passport", "certificate", "photo", "supporting"]);
export const revisionSchema = z.number().int().nonnegative().max(2147483646);
export function submissionSchema(questions: Question[], minimumAge: number | null, now = new Date()) {
  return draftSchema.superRefine((value, ctx) => {
    const complete = applicationSchema.safeParse(value);
    if (!complete.success) complete.error.issues.forEach(issue => ctx.addIssue({ code: "custom", path: issue.path, message: issue.message }));
    for (const [key, val] of Object.entries(value.personal)) {
      if (key !== "middle_name" && !val.trim()) ctx.addIssue({ code: "custom", path: ["personal", key], message: "Required." });
    }
    if (value.personal.date_of_birth) {
      const today = now.toISOString().slice(0,10);
      const dob = value.personal.date_of_birth;
      const age = now.getUTCFullYear() - Number(dob.slice(0,4)) - (today.slice(5) < dob.slice(5) ? 1 : 0);
      if (dob >= today || (minimumAge !== null && age < minimumAge)) ctx.addIssue({ code: "custom", path: ["personal", "date_of_birth"], message: "Date of birth does not meet vacancy requirements." });
    }
    if (value.identification.passport_available && (!value.identification.passport_number.trim() || !value.identification.passport_expiry)) ctx.addIssue({ code: "custom", path: ["identification"], message: "Enter the passport number and expiry, or select no passport." });
    questions.filter(q => q.required && !value.answers[q.id]?.trim()).forEach(q => ctx.addIssue({ code: "custom", path: ["answers", q.id], message: `Answer ${q.label}` }));
  });
}
