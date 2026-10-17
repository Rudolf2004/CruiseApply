import { apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
import { paymentLimit } from "@/features/payments/service";
import { saveDraft } from "@/features/applications/service";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const { user } = await apiUser();
    await paymentLimit(`draft:${user.id}`, 120, 60);
    return json(await saveDraft(user.id, (await params).id, await readJson(request)));
  } catch (error) { return apiError(error); }
}
