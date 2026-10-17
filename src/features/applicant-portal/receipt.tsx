"use client";
import {Button,StatusBadge} from "@/components/ui";
import {formatAmount} from "@/features/payments/pricing";
import type {PortalData} from "./schema";
export function ApplicantReceipt({data}:{data:PortalData}) {
 const {payment,voucher,product}=data;
 const fixture=payment.provider==="ui_preview_fixture";
 const date=payment.paid_at?new Intl.DateTimeFormat("en-GB",{dateStyle:"long",timeStyle:"short",timeZone:"UTC"}).format(new Date(payment.paid_at))+" UTC":"Not confirmed";
 return <article className="applicant-receipt" aria-label="Payment receipt">
  <div className="receipt-heading"><div><p className="receipt-brand">Cruise<span>Apply</span></p><p>Candidate screening &amp; matching</p></div><div><h2>{fixture?"Preview receipt":"Payment receipt"}</h2><StatusBadge status={payment.status}/></div></div>
  {fixture&&<p className="receipt-preview">DEVELOPMENT PREVIEW — No payment was collected. This is not proof of purchase.</p>}
  <div className="receipt-total"><div><p>{fixture?"Simulated amount":payment.status==="successful"?"Amount paid":"Transaction amount"}</p><strong>{formatAmount(payment.charge_amount,payment.charge_currency)}</strong></div><p>{date}</p></div>
  <section className="receipt-product"><h3>Application access</h3><p>{product.name}</p><p className="muted">{product.validity_days} days to redeem an unused voucher</p></section>
  <dl className="receipt-details">{Object.entries({"Payment reference":payment.reference,"Voucher serial":voucher.serial,"Payment provider":fixture?"Development fixture":payment.provider,"Provider transaction ID":payment.provider_id??"Not available"}).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  {payment.display_currency&&payment.display_amount!==null&&payment.display_currency!==payment.charge_currency&&<p className="receipt-estimate">Checkout estimate: {formatAmount(payment.display_amount,payment.display_currency,payment.display_minor_units??2)}. The actual charge is shown above.</p>}
  <div className="receipt-note"><p>Thank you for choosing CruiseApply.</p><p>Your purchase covers application access and candidate screening. Employer hiring decisions remain separate; employment, interviews and referrals are not guaranteed.</p><p>Keep this receipt for your records. Your PIN is never included.</p></div>
  <div className="receipt-controls"><Button onClick={()=>window.print()}>Print / Save as PDF</Button></div>
 </article>;
}
