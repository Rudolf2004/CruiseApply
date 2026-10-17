import { apiError,apiUser,assertSameOrigin,json,readJson } from "@/lib/http";
import { reviewApplication } from "@/features/admin-review/service";
export async function POST(request: Request,{ params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const { user } = await apiUser(true);
    return json(await reviewApplication(user.id,(await params).id,await readJson(request)));
  } catch (error) { return apiError(error); }
}
