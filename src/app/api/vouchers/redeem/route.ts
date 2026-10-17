import { apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
import { redeemVoucher } from "@/features/vouchers/service";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await apiUser();
    return json({ applicationId: await redeemVoucher(user.id, await readJson(request)) });
  } catch (error) { return apiError(error); }
}
