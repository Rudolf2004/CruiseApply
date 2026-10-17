"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {Alert,Button} from "@/components/ui";

export function MatchingForm({operation,defaults,children,label="Save"}:{operation:string;defaults:Record<string,unknown>;children:React.ReactNode;label?:string}){
 const router=useRouter(),pending=useRef<Record<string,unknown>|null>(null),flight=useRef(false),[busy,setBusy]=useState(false),[retry,setRetry]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 return <form className="grid gap-4" onSubmit={e=>{e.preventDefault();if(flight.current)return;flight.current=true;const form=e.currentTarget;const fields=new FormData(form);const data={...defaults,...Object.fromEntries(fields.entries())};
 if(operation==="opportunity_save"){data.authorized=fields.get("authorized")==="on";data.checkedAt=fields.get("checkedAt")?new Date(String(fields.get("checkedAt"))+"Z").toISOString():null;}
 if(operation==="consent_request")data.documentIds=fields.getAll("documentIds");
 pending.current??={operation,requestId:crypto.randomUUID(),data};setBusy(true);setRetry(true);setError("");setNotice("");
 void fetch("/api/admin/matching",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(pending.current)}).then(async response=>{const result=await response.json();if(!response.ok){if(response.status<500){pending.current=null;setRetry(false);}throw new Error(result.error??"Matching unavailable.");}pending.current=null;setRetry(false);if(defaults.revision===0)form.reset();setNotice("Saved. No candidate data was transmitted by this action.");router.refresh();}).catch(e=>setError(e.message??"Retry the same request.")).finally(()=>{flight.current=false;setBusy(false);});
 }}><fieldset disabled={busy||retry} className="grid gap-4">{children}</fieldset>{error&&<Alert error>{error}</Alert>}{notice&&<Alert>{notice}</Alert>}<div className="flex gap-3"><Button disabled={busy}>{retry?"Retry same request":label}</Button>{retry&&<Button type="button" className="secondary" disabled={busy} onClick={()=>{window.location.reload();}}>Reload record</Button>}</div></form>;
}
