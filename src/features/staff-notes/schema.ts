import { z } from "zod";
export const noteSchema = z.object({ requestId: z.uuid(),revision: z.number().int().min(0).max(2147483647),body: z.string().trim().min(10).max(5000) }).strict();
