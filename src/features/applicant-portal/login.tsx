"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ui";
export function ApplicantLoginForm() {
  const router=useRouter(),[serial,setSerial]=useState(""),[pin,setPin]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  return <Card><form className="grid gap-5" autoComplete="off" onSubmit={async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError("");
    try{const response=await fetch("/api/applicant-auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({serial,pin})});
      if(!response.ok)throw new Error(response.status===429?"Please wait before trying again.":"Unable to sign in. Check your serial number and PIN, or try again shortly.");
      router.replace("/applicant");router.refresh();
    }catch(error){setError(error instanceof Error?error.message:"Please try again.");}finally{setPin("");setBusy(false);}
  }}><label className="field">Voucher serial number<input name="serial" value={serial} onChange={e=>setSerial(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} required maxLength={100}/></label>
    <label className="field">PIN<input name="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} required pattern="[0-9]{8}" minLength={8} maxLength={8}/></label>
    {error&&<Alert error>{error}</Alert>}<Button disabled={busy}>{busy?"Signing in…":"Applicant Login"}</Button><p className="text-sm muted">Use the credentials issued for your voucher. An email/password account is not required. Keep your PIN private.</p>
  <Link href="/applicant/recovery" className="text-primary">Forgot your PIN? Reset it securely</Link></form></Card>;
}
