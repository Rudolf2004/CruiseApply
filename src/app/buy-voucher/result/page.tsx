import { notFound } from "next/navigation";
import { PublicShell } from "@/components/public-shell";
import { PageHeader } from "@/components/ui";
import { CheckoutResult } from "@/features/guest-checkout/result";
export const dynamic="force-dynamic";
export default function Result(){if(process.env.APPLICANT_AUTH_ENABLED!=="true")notFound();return <PublicShell><main id="main" className="container max-w-3xl py-12"><PageHeader eyebrow="Application access" title="Your voucher purchase" description="Confirm your payment and receive your applicant credentials."/><CheckoutResult/></main></PublicShell>;}
