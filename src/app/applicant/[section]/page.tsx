import { notFound } from "next/navigation";
import { ApplicantPortalPage } from "@/features/applicant-portal/page";
import type { PortalSection } from "@/features/applicant-portal/view";
export const dynamic="force-dynamic";
export default async function Page({params,searchParams}:{params:Promise<{section:string}>;searchParams:Promise<{page?:string}>}){const {section}=await params;if(!["application","documents","notifications","payment"].includes(section))notFound();const page=Number((await searchParams).page??1);if(!Number.isInteger(page)||page<1||page>10000)notFound();return <ApplicantPortalPage section={section as PortalSection} page={page}/>;}
