import { portalSave } from "@/features/applicant-portal/handlers";
export const runtime = "nodejs";
export async function PATCH(request: Request, {params}: {params: Promise<{id:string}>}) {return portalSave(request,(await params).id);}
