"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ui";
import { sendJson } from "@/lib/client-api";
export function RedemptionForm({ jobs, initialSerial = "", initialJob = "" }: {
  jobs: { id: string; title: string; company: string | null; service_description: string }[]; initialSerial?: string; initialJob?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [jobId, setJobId] = useState(initialJob);
  return <Card><form className="grid gap-6" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try {
      const result = await sendJson<{ applicationId: string }>("/api/vouchers/redeem", {
        serial: String(form.get("serial")).trim().toUpperCase(), pin: form.get("pin"), jobId: form.get("jobId"),
      });
      router.push(`/dashboard/applications/${result.applicationId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); setBusy(false); }
  }}>
    <label className="field">Voucher serial<input name="serial" defaultValue={initialSerial} required maxLength={17} pattern="CRV-[0-9]{4}-[0-9]{8}" autoComplete="off" placeholder="CRV-2026-00000003"/></label>
    <label className="field">Voucher PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} required autoComplete="off"/></label>
    <label className="field">CruiseApply opportunity<select name="jobId" required value={jobId} onChange={event => setJobId(event.target.value)}><option value="">Choose an opportunity</option>{jobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label>
    {jobId && <Alert>{jobs.find(job => job.id === jobId)?.service_description}</Alert>}
    <Alert>Activating your voucher starts one application to CruiseApply for the selected screening opportunity. You can save your progress and return later. A linked voucher can only be used for its original opportunity.</Alert>
    {error && <Alert error>{error}</Alert>}
    <Button disabled={busy}>{busy ? "Starting application…" : "Verify voucher & start application"}</Button>
  </form></Card>;
}
