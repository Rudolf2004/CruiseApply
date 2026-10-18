"use client";
import { applicationServiceDescription } from "@/features/jobs/service-description";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { Alert,Button,Card } from "@/components/ui";
import { sendJson } from "@/lib/client-api";
import { formatAmount,type PriceQuote } from "./pricing";
export type VoucherType={id:string;name:string;description:string;validity_days:number};
type EarlierPayment={reference:string;status:string;charge_amount:number;charge_currency:string;claim_available:boolean|null};
export function PurchaseForm({types,countries,jobId,serviceDescription,guest=false}:{types:VoucherType[];countries:{code:string;name:string}[];jobId?:string;serviceDescription?:string;guest?:boolean}){
 const [email,setEmail]=useState(""),[name,setName]=useState(""),[selected,setSelected]=useState(types[0]?.id??""),[country,setCountry]=useState("");
 const [quote,setQuote]=useState<PriceQuote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [earlier,setEarlier]=useState<EarlierPayment|null>(null),[checking,setChecking]=useState(guest),[separate,setSeparate]=useState(false);
 const flight=useRef(false),endpoint=guest?"/api/guest-checkout":"/api/payments";
 const pending=earlier&&["pending","initialized"].includes(earlier.status);
 const unclaimed=earlier?.status==="successful"&&earlier.claim_available!==false;
 useEffect(()=>{
  if(!guest)return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);let active=true;
  void fetch("/api/guest-checkout/status",{cache:"no-store",signal:controller.signal}).then(async response=>{if(response.ok){const data=await response.json();if(active)setEarlier(data.payment??null);}}).catch(()=>{}).finally(()=>{clearTimeout(timer);if(active)setChecking(false);});
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[guest]);
 async function run(work:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setError("");try{await work();}catch(cause){setError(cause instanceof Error?cause.message:"Checkout is unavailable.");if(guest&&!quote){try{const response=await fetch("/api/guest-checkout/status",{cache:"no-store",signal:AbortSignal.timeout(8000)});if(response.ok){const data=await response.json();setEarlier(data.payment??null);setSeparate(false);}}catch{/* Preserve the original error. */}}}finally{flight.current=false;setBusy(false);}}
 function redirectToPayment(value:string){const url=new URL(value);if(url.protocol!=="https:"||url.hostname!=="checkout.paystack.com"||url.username||url.password)throw new Error("Checkout is unavailable.");window.location.assign(url.href);}
 async function review(){
  const result=await sendJson<{quote:PriceQuote}>(endpoint+"/quote",{voucherTypeId:selected,countryCode:country,...(guest?{email,name,...(pending&&separate?{startNewForReference:earlier.reference}:{})}:{})});
  setQuote(result.quote);setEarlier(null);setSeparate(false);
 }
 return <form className="grid gap-6" onSubmit={event=>{event.preventDefault();void run(async()=>{if(!quote){await review();return;}const result=await sendJson<{authorizationUrl:string}>(endpoint+"/initialize",{quoteId:quote.id,...(jobId?{jobId}:{})});redirectToPayment(result.authorizationUrl);});}}>
  <Card><h2 className="font-bold mb-3">CruiseApply application access</h2><p className="text-sm leading-6">{serviceDescription||applicationServiceDescription}</p></Card>
  {checking&&<p role="status" className="muted text-sm">Checking for an existing checkout…</p>}
  {guest&&earlier&&!quote&&<Card>
   <h2 className="font-bold text-lg">{pending?"Continue your existing checkout":unclaimed?"Your voucher is ready":"Your previous purchase"}</h2>
   <p className="mt-3 break-all">Reference: {earlier.reference}</p><p className="my-3">{formatAmount(earlier.charge_amount,earlier.charge_currency)} · {earlier.status}</p>
   <Link href="/buy-voucher/result" className="text-primary underline">{unclaimed?"Receive your Serial Number and PIN":"View payment status"}</Link>
   {pending&&<><Button type="button" className="secondary mt-4" disabled={busy} onClick={()=>void run(async()=>{const result=await sendJson<{authorizationUrl:string}>("/api/guest-checkout/resume",{});redirectToPayment(result.authorizationUrl);})}>Continue existing payment</Button><p className="my-4 text-sm">If you already paid, check its status before paying again. To buy a separate voucher, save the reference above. The earlier payment may still complete; verified PIN recovery can recover its credentials using that reference.</p><label className="flex items-start gap-3"><input type="checkbox" checked={separate} disabled={busy} onChange={event=>{setSeparate(event.target.checked);setError("");}}/><span>I want a separate voucher and have saved the earlier reference.</span></label></>}
   {unclaimed&&<p className="mt-3">Receive and save your credentials before starting another purchase.</p>}
   {!pending&&!unclaimed&&<p className="mt-3 text-sm">You can purchase another voucher below. Each voucher has its own Serial Number, PIN and application.</p>}
  </Card>}
  <fieldset disabled={busy} className="grid gap-4"><legend className="font-semibold mb-4">Choose your voucher</legend>{types.map(type=><label key={type.id} className={`card flex gap-4 cursor-pointer ${selected===type.id?"ring-2 ring-primary":""}`}><input type="radio" name="voucherType" value={type.id} checked={selected===type.id} onChange={()=>{setSelected(type.id);setQuote(null);setError("");}} className="mt-1"/><span className="grid gap-2"><span className="font-bold text-xl">{type.name}</span><span className="muted text-sm">{type.description}</span><span className="text-sm muted">One application · Valid for {type.validity_days} days after payment</span></span></label>)}</fieldset>
  {guest&&<fieldset disabled={busy} className="grid gap-4"><legend className="font-semibold mb-4">Your contact details</legend><p className="text-sm muted">After verified payment, receive your Serial Number and PIN for the applicant portal. Keep access to this email for secure PIN recovery.</p><label className="field">Full name<input required maxLength={200} autoComplete="name" value={name} onChange={event=>{setName(event.target.value);setQuote(null);}}/></label><label className="field">Email address<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event=>{setEmail(event.target.value);setQuote(null);}}/></label></fieldset>}
  <label className="field">Country of residence<select required value={country} disabled={busy} onChange={event=>{setCountry(event.target.value);setQuote(null);setError("");}}><option value="">Select your country</option>{countries.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
  {quote&&<Card><h2 className="font-bold text-lg mb-4">Review your price</h2><p className="text-xl font-bold">Charged by Paystack: {formatAmount(quote.charge_amount,quote.charge_currency)}</p>{quote.display_currency!==quote.charge_currency?<><p className="mt-3">Estimated local price: {formatAmount(quote.display_amount,quote.display_currency,quote.display_minor_units)}</p><p className="muted text-sm mt-2">This is an estimate only. You will be charged in GHS. Your bank or payment provider may apply a different conversion rate or fees.</p><p className="muted text-xs mt-2">Rate: 1 GHS = {quote.exchange_rate} {quote.display_currency}. Source: {quote.exchange_rate_source}; as of {quote.exchange_rate_as_of?new Date(quote.exchange_rate_as_of).toLocaleString("en-GB"):"—"}.</p></>:<p className="muted text-sm mt-3">The GHS charge is authoritative. Local estimates appear only when a current rate is configured.</p>}<p className="muted text-xs mt-4">Price review expires {new Date(quote.expires_at).toLocaleTimeString("en-GB")}.</p><button type="button" disabled={busy} className="text-primary text-sm mt-3" onClick={()=>{setQuote(null);setError("");}}>Refresh price</button></Card>}
  <Card><p className="text-sm muted leading-6">This is a one-time voucher purchase for one application. CruiseApply provides application access and screening; employer hiring decisions remain separate. Complete payment securely with Paystack.</p></Card>
  {error&&<Alert error>{error}</Alert>}
  <Button disabled={busy||checking||!selected||!country||Boolean(!quote&&(unclaimed||(pending&&!separate)))}>{busy?"Please wait…":quote?`Pay ${formatAmount(quote.charge_amount,quote.charge_currency)} with Paystack`:pending&&separate?"Review separate purchase":"Review price"}</Button>
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
