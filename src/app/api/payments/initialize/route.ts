import { z } from "zod";
import { apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
import { initializePurchase } from "@/features/payments/service";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await apiUser();
    const input = z.object({ quoteId: z.uuid(), jobId: z.uuid().optional() }).strict().parse(await readJson(request));
    return json(await initializePurchase(user, input.quoteId, input.jobId));
  } catch (error) { return apiError(error); }
}
