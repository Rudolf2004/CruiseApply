"use client";
import { useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { Alert,Button } from "@/components/ui";
import { reviewTransitions } from "./schema";
type Decision = { requestId: string;revision: number;status: string;message: string };
export function StaffReviewForm({ id,status,revision }: { id: string;status: string;revision: number }) {
  const router = useRouter(); const choices = reviewTransitions[status] ?? [];
  const [next,setNext] = useState(choices[0] ?? ""); const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false); const [error,setError] = useState(""); const [notice,setNotice] = useState("");
  const [pending,setPending] = useState<Decision | null>(null); const inFlight = useRef(false);
  if (!choices.length) return <Alert>{status === "draft" ? "This applicant has not submitted the draft. Screening decisions are unavailable." : "This is a terminal screening status. It cannot be reopened through staff review."}</Alert>;
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const decision = pending ?? { requestId: crypto.randomUUID(),revision,status: next,message: message.trim() };
    setPending(decision);
    try {
      const response = await fetch(`/api/admin/applications/${id}/review`,{ method: "POST",headers: { "Content-Type": "application/json" },body: JSON.stringify(decision) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        throw new Error(result.error || "Review unavailable.");
      }
      setPending(null); setMessage(""); setNotice("Decision recorded. The applicant can view the screening update."); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Request interrupted. Retry the same decision to confirm its result."); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit(); }} className="grid gap-4">
    <p className="muted text-sm">These are CruiseApply screening decisions. Accepted means internally accepted/qualified, not employment or selection by a cruise company, and does not guarantee employer referral. Withdrawal is an applicant-driven operation and is unavailable here.</p>
    <label className="grid gap-2">Screening decision<select value={next} disabled={busy || !!pending} onChange={event => setNext(event.target.value)} required>{choices.map(value => <option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label>
    <label className="grid gap-2">Message visible to the applicant<textarea value={message} onChange={event => setMessage(event.target.value)} disabled={busy || !!pending} minLength={10} maxLength={2000} rows={5} required/></label>
    {pending && !busy && <Alert>A request may already have reached the server. Retry confirms the same decision without creating another update.</Alert>}
    {error && <Alert error>{error}</Alert>}{notice && <Alert>{notice}</Alert>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy}>{busy ? "Recording decision..." : pending ? "Retry same decision" : "Record screening decision"}</Button><Button type="button" className="secondary" disabled={busy} onClick={() => router.refresh()}>Refresh application</Button></div>
  </form>;
}
