import { uploadResponse } from "@/features/applicant-actions/handlers";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return uploadResponse(request,(await params).id);}
