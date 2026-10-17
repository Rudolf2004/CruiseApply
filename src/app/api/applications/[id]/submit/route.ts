import { apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
import { paymentLimit } from "@/features/payments/service";
import { submitApplication } from "@/features/applications/service";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const { user } = await apiUser();
    await paymentLimit(`submit:${user.id}`, 10, 60);
    return json(await submitApplication(user.id, (await params).id, await readJson(request)));
  } catch (error) { return apiError(error); }
}
