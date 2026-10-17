import { z } from "zod";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { serviceDatabase } from "@/lib/supabase/server";
import { decryptVoucherPin } from "@/lib/voucher-credentials";
import { Alert, ButtonLink, Card, PageHeader, StatusBadge } from "@/components/ui";
import { PrintReceipt } from "@/features/payments/purchase-form";
import { PriceSnapshot } from "@/features/payments/price-snapshot";
export default async function VoucherReceipt({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser(); const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = serviceDatabase();
  const { data: voucher, error } = await db.from("vouchers").select("id,serial,status,expires_at,purchased_at,pin_encrypted,payment_id,user_id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) throw new Error("Voucher unavailable.");
  if (!voucher) notFound();
  const payment = await db.from("payments").select("reference,charge_amount,charge_currency,paid_at,display_amount,display_currency,display_minor_units,exchange_rate,exchange_rate_source,exchange_rate_as_of,country_code").eq("id", voucher.payment_id).eq("user_id", user.id).single();
  if (payment.error) throw new Error("Receipt unavailable.");
  const access=await db.from("voucher_access").select("credential_state,revoked_at,suspended_at").eq("voucher_id",voucher.id).maybeSingle();
  if(access.error)throw new Error("Voucher access unavailable.");
  const showLegacyPin=!access.data||(access.data.credential_state==="legacy"&&!access.data.revoked_at&&!access.data.suspended_at);
  const status = voucher.status === "unused" && new Date(voucher.expires_at).getTime() <= new Date().getTime() ? "expired" : voucher.status;
  return <><PageHeader title="Voucher & receipt" description="Keep your voucher credentials private."/><Card className="max-w-2xl"><div className="flex justify-between gap-4"><h2 className="text-xl font-bold">CruiseApply</h2><StatusBadge status={status}/></div><PriceSnapshot payment={payment.data}/><dl className="grid gap-5 my-8"><div><dt className="muted text-sm">Voucher serial</dt><dd className="text-xl font-bold font-mono">{voucher.serial}</dd></div><div><dt className="muted text-sm">Voucher PIN</dt><dd className="font-mono text-2xl tracking-widest">{showLegacyPin?decryptVoucherPin(voucher.pin_encrypted):"PIN has been rotated or access restricted. Use Applicant Login or verified PIN reset."}</dd></div><div><dt className="muted text-sm">Payment reference</dt><dd className="break-all">{payment.data.reference}</dd></div><div><dt className="muted text-sm">Purchase date</dt><dd>{new Date(voucher.purchased_at).toLocaleDateString("en-GB")}</dd></div><div><dt className="muted text-sm">Expires</dt><dd>{new Date(voucher.expires_at).toLocaleDateString("en-GB")}</dd></div></dl><Alert>A voucher supports one application. It does not guarantee employment.</Alert><div className="flex flex-wrap gap-3 mt-6 print:hidden"><PrintReceipt/>{status === "unused" && <ButtonLink href={`/voucher/verify?serial=${voucher.serial}`}>Start application</ButtonLink>}{status === "used" && <ButtonLink href="/dashboard/applications">My applications</ButtonLink>}<ButtonLink secondary href="/dashboard/vouchers">All vouchers</ButtonLink></div></Card></>;
}
