import { portalUpload } from "@/features/applicant-portal/handlers";
export const runtime = "nodejs";
export async function POST(request: Request, {params}: {params: Promise<{id:string}>}) {return portalUpload(request,(await params).id);}
