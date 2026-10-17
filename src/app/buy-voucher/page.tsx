import { z } from "zod";
import { notFound } from "next/navigation";
import {ApplicantUnavailable} from "@/components/applicant-unavailable";
import { serviceDatabase } from "@/lib/supabase/server";
import { PublicShell } from "@/components/public-shell";
import { EmptyState, PageHeader } from "@/components/ui";
import { PurchaseForm } from "@/features/payments/purchase-form";
export default async function BuyVoucher({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const guest = process.env.APPLICANT_AUTH_ENABLED === "true";
  if (!guest) return <ApplicantUnavailable purchase/>;
  const db = serviceDatabase();
  const { job } = await searchParams;
  let title: string | undefined; let serviceDescription: string | undefined;
  if (job) {
    if (!z.uuid().safeParse(job).success) notFound();
    const result = await db.from("jobs").select("title,application_deadline,service_description").eq("id", job).eq("status", "published").eq("sample", false).eq("opportunity_type", "managed").maybeSingle();
    if (result.error) throw new Error("Job lookup unavailable.");
    if (!result.data || (result.data.application_deadline && new Date(result.data.application_deadline).getTime() <= new Date().getTime())) notFound();
    title = result.data.title; serviceDescription = result.data.service_description;
  }
  const { data, error } = await db.from("voucher_types").select("id,name,description,validity_days").eq("active", true).eq("code", "application-access");
  if (error) throw new Error("Voucher options are unavailable.");
  const countryResult = await db.from("pricing_countries").select("code,name").eq("active", true);
  if (countryResult.error) throw new Error("Country options are unavailable.");
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const countries = countryResult.data.map(country => ({ code: country.code, name: country.name || names.of(country.code) || country.code })).sort((a,b) => a.name.localeCompare(b.name));
  return <PublicShell><main id="main" className="purchase-workspace"><div><PageHeader eyebrow="Your next step" title="Purchase a voucher" description={title ? `Start your application for ${title}.` : "Choose a voucher for your next cruise career application."}/>{data.length ? <PurchaseForm guest={guest} types={data} countries={countries} jobId={job} serviceDescription={serviceDescription}/> : <EmptyState title="Voucher sales are not open yet" description="Please check back when voucher options become available." href="/jobs" action="Browse opportunities"/>}</div></main></PublicShell>;
}

