import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ApplicantAuthError, applicantToken, assertApplicantRollout } from "@/features/applicant-auth/policy";
import { loadPortalPageData } from "./service";
import { PortalView, type PortalSection } from "./view";
export async function ApplicantPortalPage({section="overview",page=1}:{section?:PortalSection;page?:number}){
  let loaded;
  try{assertApplicantRollout();const request=new Request("https://applicant.invalid",{headers:await headers()});loaded=await loadPortalPageData(applicantToken(request),page,section==="application");}
  catch(error){if(error instanceof ApplicantAuthError){if(error.status===404)notFound();if(error.status===401)redirect("/applicant/login");}throw new Error("Applicant portal unavailable. Please retry.");}
  return <PortalView {...loaded} section={section} page={page}/>;
}
