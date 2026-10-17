import { z } from "zod";
import { ApiError, apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { paymentLimit } from "@/features/payments/service";
import { quoteSchema } from "@/features/payments/pricing";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await apiUser();
    const input = z.object({ voucherTypeId: z.uuid(), countryCode: z.string().regex(/^[A-Z]{2}$/) }).strict().parse(await readJson(request));
    await paymentLimit(`quote:${user.id}`, 30);
    const { data, error } = await serviceDatabase().rpc("quote_voucher_price", { p_user_id: user.id, p_type_id: input.voucherTypeId, p_country_code: input.countryCode });
    if (error) throw new ApiError(409, "Pricing is unavailable for this selection. Please try again later.");
    return json({ quote: quoteSchema.parse(data) });
  } catch (error) { return apiError(error); }
}
