"use client";
import { useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { Alert,Button } from "@/components/ui";
type NoteRequest = { requestId: string;revision: number;body: string };
export function StaffNoteForm({ id,revision }: { id: string;revision: number }) {
  const router = useRouter(); const [body,setBody] = useState("");
  const [busy,setBusy] = useState(false); const [error,setError] = useState(""); const [notice,setNotice] = useState("");
  const [pending,setPending] = useState<NoteRequest | null>(null); const inFlight = useRef(false);
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const note = pending ?? { requestId: crypto.randomUUID(),revision,body: body.trim() }; setPending(note);
    try {
      const response = await fetch(`/api/admin/applications/${id}/notes`,{ method: "POST",headers: { "Content-Type": "application/json" },body: JSON.stringify(note) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        throw new Error(result.error || "Staff notes unavailable.");
      }
      setPending(null); setBody(""); setNotice("Internal note saved. No applicant update was sent."); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Request interrupted. Retry the same note to confirm its result."); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit(); }} className="grid gap-4">
    <p className="muted text-sm">Only authorized CruiseApply staff can read these notes. Adding a note does not change screening status or notify the applicant.</p>
    <label className="grid gap-2">Internal staff note<textarea value={body} onChange={event => setBody(event.target.value)} disabled={busy || !!pending} minLength={10} maxLength={5000} rows={5} required/></label>
    {pending && !busy && <Alert>Confirmation was interrupted. Retry confirms the same note without adding another copy.</Alert>}
    {error && <Alert error>{error}</Alert>}{notice && <Alert>{notice}</Alert>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy}>{busy ? "Saving note..." : pending ? "Retry same note" : "Save internal note"}</Button><Button type="button" className="secondary" disabled={busy} onClick={() => router.refresh()}>Refresh note context</Button></div>
  </form>;
}
