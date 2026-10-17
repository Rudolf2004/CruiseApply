"use client";
import { applicationServiceDescription } from "@/features/jobs/service-description";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ui";
import { sendJson } from "@/lib/client-api";
import { formatAmount, type PriceQuote } from "./pricing";

export type VoucherType = { id: string; name: string; description: string; validity_days: number };
export function PurchaseForm({ types, countries, jobId, serviceDescription, guest = false }: { types: VoucherType[]; countries: { code: string; name: string }[]; jobId?: string; serviceDescription?: string; guest?: boolean }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const endpoint = guest ? "/api/guest-checkout" : "/api/payments";
  const [selected, setSelected] = useState(types[0]?.id ?? "");
  const [country, setCountry] = useState(""); const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <form className="grid gap-6" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!quote) {
        const result = await sendJson<{ quote: PriceQuote }>(`${endpoint}/quote`, { voucherTypeId: selected, countryCode: country, ...(guest ? {email,name} : {}) });
        setQuote(result.quote); setBusy(false); return;
      }
      const result = await sendJson<{ authorizationUrl: string }>(`${endpoint}/initialize`, { quoteId: quote.id, ...(jobId ? { jobId } : {}) });
      const url = new URL(result.authorizationUrl);
      if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com") throw new Error("Checkout is unavailable.");
      window.location.assign(url.href);
    } catch (error) { setError(error instanceof Error ? error.message : "Checkout is unavailable."); setBusy(false); }
  }}>
    <Card><h2 className="font-bold mb-3">CruiseApply application access</h2><p className="text-sm leading-6">{serviceDescription || applicationServiceDescription}</p></Card><fieldset disabled={busy} className="grid gap-4"><legend className="font-semibold mb-4">Choose your voucher</legend>{types.map(type => <label key={type.id} className={`card flex gap-4 cursor-pointer ${selected === type.id ? "ring-2 ring-primary" : ""}`}><input type="radio" name="voucherType" value={type.id} checked={selected === type.id} onChange={() => { setSelected(type.id); setQuote(null); setError(""); }} className="mt-1"/><span className="grid gap-2"><span className="font-bold text-xl">{type.name}</span><span className="muted text-sm">{type.description}</span><span className="text-sm muted">One application · Valid for {type.validity_days} days after payment</span></span></label>)}</fieldset>
    {guest && <fieldset disabled={busy} className="grid gap-4"><legend className="font-semibold mb-4">Your contact details</legend><p className="text-sm muted">No email/password account is required. After verified payment, you will receive a voucher Serial Number and PIN for your applicant portal.</p><label className="field">Full name<input required maxLength={200} autoComplete="name" value={name} onChange={event=>{setName(event.target.value);setQuote(null);}}/></label><label className="field">Email address<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event=>{setEmail(event.target.value);setQuote(null);}}/></label><Link href="/buy-voucher/result" className="text-primary text-sm">Return to this browser’s existing checkout</Link></fieldset>}
    <label className="field">Country of residence<select required value={country} disabled={busy} onChange={event => { setCountry(event.target.value); setQuote(null); setError(""); }}><option value="">Select your country</option>{countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    {quote && <Card><h2 className="font-bold text-lg mb-4">Review your price</h2><p className="text-xl font-bold">Charged by Paystack: {formatAmount(quote.charge_amount, quote.charge_currency)}</p>{quote.display_currency !== quote.charge_currency ? <><p className="mt-3">Estimated local price: {formatAmount(quote.display_amount, quote.display_currency, quote.display_minor_units)}</p><p className="muted text-sm mt-2">This is an estimate only. You will be charged in GHS. Your bank or payment provider may apply a different conversion rate or fees.</p><p className="muted text-xs mt-2">Rate: 1 GHS = {quote.exchange_rate} {quote.display_currency}. Source: {quote.exchange_rate_source}; as of {quote.exchange_rate_as_of ? new Date(quote.exchange_rate_as_of).toLocaleString("en-GB") : "—"}.</p></> : <p className="muted text-sm mt-3">Pricing is shown in GHS. If a current local estimate is unavailable for your country, the GHS charge remains authoritative.</p>}<p className="muted text-xs mt-4">Price review expires {new Date(quote.expires_at).toLocaleTimeString("en-GB")}.</p><button type="button" disabled={busy} className="text-primary text-sm mt-3" onClick={() => { setQuote(null); setError(""); }}>Refresh price</button></Card>}
    <Card><p className="text-sm muted leading-6">This is a one-time voucher purchase. A voucher lets you start one application; it does not guarantee an interview or employment. You will complete payment securely with Paystack.</p></Card>
    {error && <Alert error>{error}</Alert>}<Button disabled={busy || !selected || !country}>{busy ? "Please wait…" : quote ? `Pay ${formatAmount(quote.charge_amount, quote.charge_currency)} with Paystack` : "Review price"}</Button>
  </form>;
}
export function VerifyPaymentButton({ reference }: { reference: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <div className="mt-4 grid gap-3">{error && <Alert error>{error}</Alert>}<Button disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { const result = await sendJson<{ voucherId: string }>("/api/payments/verify", { reference }); router.push(`/dashboard/vouchers/${result.voucherId}`); router.refresh(); }
    catch { setError("Payment could not yet be confirmed. If you paid, wait a moment and check again. Your purchase stays in your payment history."); setBusy(false); }
  }}>{busy ? "Checking payment…" : "Check payment status"}</Button></div>;
}
export function PrintReceipt() { return <Button onClick={() => window.print()}>Print receipt</Button>; }
