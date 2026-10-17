import { listResponses,submitResponse } from "@/features/applicant-actions/handlers";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return listResponses(request,(await params).id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return submitResponse(request,(await params).id);}
