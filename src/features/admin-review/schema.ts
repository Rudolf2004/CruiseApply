import { z } from "zod";
export const reviewStatuses = ["under_review","additional_information_required","shortlisted","interview","final_review","accepted","unsuccessful"] as const;
export const reviewTransitions: Record<string,readonly string[]> = {
  submitted: ["under_review"],under_review: ["additional_information_required","shortlisted","unsuccessful"],
  additional_information_required: ["under_review"],shortlisted: ["interview","final_review","unsuccessful"],
  interview: ["final_review","unsuccessful"],final_review: ["accepted","unsuccessful","additional_information_required"],
};
export const reviewSchema = z.object({ requestId: z.uuid(),revision: z.number().int().min(0).max(2147483646),status: z.enum(reviewStatuses),message: z.string().trim().min(10).max(2000) }).strict();
