import { appUrl } from "@/lib/config";
import { ApiError, apiUser } from "@/lib/http";
import { paymentLimit, verifyAndFulfill } from "@/features/payments/service";
export async function GET(request: Request) {
  const reference = new URL(request.url).searchParams.get("reference") ?? "";
  const target = new URL("/dashboard/payments", appUrl);
  if (/^CA-[a-f\d-]{36}$/.test(reference)) {
    target.searchParams.set("reference", reference);
    try {
      const { user } = await apiUser();
      await paymentLimit(`verify:${user.id}`, 20);
      const voucherId = await verifyAndFulfill(reference, user.id);
      target.pathname = `/dashboard/vouchers/${voucherId}`;
      target.search = "";
    } catch (error) {
      const inaccessible = error instanceof ApiError && [401, 403, 404].includes(error.status);
      target.searchParams.set("verification", inaccessible ? "account" : "pending");
    }
  }
  return new Response(null, { status: 303, headers: { Location: target.href, "Cache-Control": "no-store" } });
}
