import { withdrawApplication } from "@/features/applicant-actions/handlers";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return withdrawApplication(request,(await params).id);}
