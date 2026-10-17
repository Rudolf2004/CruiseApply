import { z } from "zod";
import { ApiError, apiError, json, readBody } from "@/lib/http";
import { validWebhookSignature } from "@/features/payments/provider";
import { verifyAndFulfill } from "@/features/payments/service";
export async function POST(request: Request) {
  try {
    const raw = await readBody(request, 262144);
    if (!validWebhookSignature(raw, request.headers.get("x-paystack-signature"))) throw new ApiError(401, "Invalid signature.");
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw new ApiError(400, "Invalid event."); }
    const event = z.object({ event: z.string(), data: z.unknown() }).parse(parsed);
    if (event.event !== "charge.success") return json({ received: true });
    const { reference } = z.object({ reference: z.string() }).parse(event.data);
    // Ignore unrelated transactions if the Paystack account serves other products.
    if (!/^CA-[a-f\d-]{36}$/.test(reference)) return json({ received: true });
    try { await verifyAndFulfill(reference); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return json({ received: true }); throw error; }
    // Acknowledge only after durable, atomic fulfillment. Failures remain retryable.
    return json({ received: true });
  } catch (error) { return apiError(error); }
}
