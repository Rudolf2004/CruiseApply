import { apiError,apiUser,assertSameOrigin,json } from "@/lib/http";
import { markNotificationRead } from "@/features/notifications/service";
export async function POST(request: Request,{ params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const { user } = await apiUser();
    return json(await markNotificationRead(user.id,(await params).id));
  } catch (error) { return apiError(error); }
}
