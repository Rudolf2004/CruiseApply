import { z } from "zod";
import { apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
import { paymentLimit, verifyAndFulfill } from "@/features/payments/service";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await apiUser();
    const { reference } = z.object({ reference: z.string().regex(/^CA-[a-f\d-]{36}$/) }).parse(await readJson(request));
    await paymentLimit(`verify:${user.id}`, 20);
    return json({ voucherId: await verifyAndFulfill(reference, user.id) });
  } catch (error) { return apiError(error); }
}
