import {notFound} from "next/navigation";
import {PageHeader} from "@/components/ui";
import {RecoveryForm} from "@/features/applicant-recovery/form";
export const dynamic="force-dynamic";
export default function Recovery(){if(process.env.APPLICANT_AUTH_ENABLED!=="true")notFound();return <main id="main" className="container max-w-xl py-16"><PageHeader title="Reset your voucher PIN" description="Verify your purchase contact and generate new credentials."/><RecoveryForm/></main>;}
