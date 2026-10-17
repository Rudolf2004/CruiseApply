import Link from "next/link";
import {ShieldCheck,ArrowRight,Waves} from "lucide-react";
import {ApplicantUnavailable} from "@/components/applicant-unavailable";
import {PublicShell} from "@/components/public-shell";
import {ApplicantLoginForm} from "@/features/applicant-portal/login";
export const dynamic="force-dynamic";
export default function Page(){
 if(process.env.APPLICANT_AUTH_ENABLED!=="true")return <ApplicantUnavailable/>;
 return <PublicShell><main id="main" className="applicant-entry"><section className="applicant-entry-story"><Waves size={44}/><p className="eyebrow">YOUR NEXT CHAPTER</p><h1>A world of possibilities.<br/>One place to begin.</h1><p>Continue your application, follow your screening progress and stay connected with CruiseApply.</p><ul><li>Build your professional candidate profile</li><li>Keep your documents together securely</li><li>Receive updates from our screening team</li></ul><Link href="/buy-voucher">New to CruiseApply? Get application access<ArrowRight size={18}/></Link></section><section className="applicant-entry-form"><span className="applicant-entry-icon"><ShieldCheck size={28}/></span><h2>Welcome back</h2><p>Sign in with your voucher Serial Number and PIN.</p><ApplicantLoginForm/><div className="applicant-entry-help"><Link href="/contact">Need help?</Link><Link href="/login">Staff Login</Link></div></section></main></PublicShell>;
}
