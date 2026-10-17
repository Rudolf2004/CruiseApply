import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {PublicShell} from "./public-shell";
import {PageHeader,ButtonLink} from "./ui";
export async function ApplicantUnavailable({purchase=false}:{purchase?:boolean}){
 const host=(await headers()).get("host")??"";
 // Local development uses the isolated HTTPS preview; production remains gated.
 if(process.env.NODE_ENV==="development"&&/^(localhost|127\.0\.0\.1):3000$/.test(host))redirect("https://localhost:3443"+(purchase?"/buy-voucher":"/applicant/login"));
 return <PublicShell><main id="main" className="container max-w-2xl py-16"><PageHeader title={purchase?"Application access":"Applicant Login"} description="Your CruiseApply journey starts with a voucher Serial Number and PIN."/><p role="status" className="mb-6">We are preparing online access. Contact our team for guidance and availability.</p><div className="flex gap-4 flex-wrap"><ButtonLink href="/contact">Contact CruiseApply</ButtonLink><ButtonLink href="/jobs" secondary>Explore opportunities</ButtonLink></div></main></PublicShell>;
}

