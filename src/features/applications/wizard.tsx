"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ui";
import { employerLabel } from "@/features/jobs/service-description";
import { sendJson } from "@/lib/client-api";
import { draftSchema, submissionSchema, type Draft, type Question } from "./schema";

type Document = { id: string; kind: string; name: string; size_bytes: number };
type Saved = { revision: number; updatedAt: string };
const steps = ["Personal information", "Identification", "Education", "Work experience", "Selected opportunity", "Documents", "Additional questions", "Review", "Declaration & submit"];
const label = (key: string) => key.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());

function Fields({ values, onChange }: { values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return <div className="grid sm:grid-cols-2 gap-5">{Object.entries(values).map(([key,value]) => <label className={`field ${["address", "responsibilities"].includes(key) ? "sm:col-span-2" : ""}`} key={key}>{label(key)}
    {["address", "responsibilities"].includes(key) ? <textarea rows={4} value={value} maxLength={key === "address" ? 500 : 5000} onChange={e => onChange(key,e.target.value)}/> :
      <input type={key.includes("date") || key.includes("expiry") ? "date" : key === "email" ? "email" : key === "phone" ? "tel" : "text"} value={value} maxLength={254} onChange={e => onChange(key,e.target.value)}/>}</label>)}</div>;
}
export function ApplicationReview({ draft, documents }: { draft: Draft; documents: Document[] }) {
  const record = (value: Record<string, string | boolean>) => <dl className="grid sm:grid-cols-2 gap-4">{Object.entries(value).map(([key,val]) => <div key={key}><dt className="muted text-sm">{label(key)}</dt><dd className="whitespace-pre-wrap break-words">{typeof val === "boolean" ? val ? "Yes" : "No" : val || "Not provided"}</dd></div>)}</dl>;
  return <div className="grid gap-8"><section><h3 className="font-bold mb-4">Personal information</h3>{record(draft.personal)}</section><section><h3 className="font-bold mb-4">Identification</h3>{record(draft.identification)}</section>{(["education", "experience"] as const).map(section => <section key={section}><h3 className="font-bold mb-4">{label(section)}</h3>{draft[section].length ? draft[section].map((item,i) => <div key={i} className="border-t border-slate-100 py-4">{record(item)}</div>) : <p className="muted">No records provided.</p>}</section>)}<section><h3 className="font-bold mb-4">Additional answers</h3>{Object.keys(draft.answers).length ? record(draft.answers) : <p className="muted">No answers provided.</p>}</section><section><h3 className="font-bold mb-4">Documents</h3>{documents.length ? <ul className="space-y-2">{documents.map(doc => <li key={doc.id}>{doc.name} ({doc.kind})</li>)}</ul> : <p className="muted">No documents uploaded.</p>}</section></div>;
}

export function ApplicationWizard({ id, initialDraft, initialRevision, updatedAt, initialDocuments, job, apiBase = "/api/applications" }: {
  id: string; initialDraft: Draft; initialRevision: number; updatedAt: string; initialDocuments: Document[]; apiBase?: "/api/applications" | "/api/applicant-portal/applications";
  job: { title: string; company: string | null; service_description: string | null; questions: Question[]; minimum_age: number | null; required_documents: string[] };
}) {
  const router = useRouter(); const [step,setStep] = useState(0); const [draft,setDraft] = useState(initialDraft);
  const [documents,setDocuments] = useState(initialDocuments); const [message,setMessage] = useState(`Last saved ${new Date(updatedAt).toLocaleString()}`);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false); const [declaration,setDeclaration] = useState(false);
  const latest = useRef(initialDraft); const saved = useRef(JSON.stringify(initialDraft)); const revision = useRef(initialRevision);
  const saving = useRef<Promise<void> | null>(null); const locked = useRef(false); const autosavePaused = useRef(false);
  const update = (value: Draft) => { latest.current = value; setDraft(value); setDeclaration(false); setMessage("Unsaved changes"); };
  const save = useCallback(async () => {
    if (saving.current) await saving.current;
    const operation = async () => {
      while (saved.current !== JSON.stringify(latest.current)) {
        const snapshot = JSON.stringify(latest.current); const parsed = draftSchema.safeParse(latest.current);
        if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).slice(0,3).join("; "));
        setMessage("Saving…");
        const result = await sendJson<Saved>(`${apiBase}/${id}`, { revision: revision.current, draft: parsed.data }, "PATCH");
        revision.current = result.revision; saved.current = snapshot;
        setMessage(`Last saved ${new Date(result.updatedAt).toLocaleString()}`); setError("");
      }
    };
    // Recheck after awaiting another save; concurrent callers must share its work.
    if (saving.current) return saving.current;
    saving.current = operation();
    try { await saving.current; } finally { saving.current = null; }
  }, [id, apiBase]);
  useEffect(() => {
    const timer = setInterval(() => { if (!locked.current && !autosavePaused.current) void save().catch(cause => { autosavePaused.current = true; setError(cause.message); setMessage("Changes not saved — use Save progress to retry"); }); }, 2000);
    const warn = (event: BeforeUnloadEvent) => { if (saved.current !== JSON.stringify(latest.current)) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || saved.current === JSON.stringify(latest.current)) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      event.preventDefault();
      if (locked.current) return;
      void save().then(() => window.location.assign(anchor.href)).catch(cause => { autosavePaused.current = true; setError(cause.message); });
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => { clearInterval(timer); window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [save]);
  async function action(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setError("");
    try { await save(); autosavePaused.current = false; await work(); } catch (cause) { autosavePaused.current = true; setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { locked.current = false; setBusy(false); }
  }
  const section = step === 2 ? "education" : "experience";
  const complete = submissionSchema(job.questions,job.minimum_age).safeParse(draft);
  const missingDocs = job.required_documents.filter(kind => !documents.some(doc => doc.kind === kind));
  const sections = [
    Object.entries(draft.personal).every(([key,val]) => key === "middle_name" || !!val.trim()),
    !draft.identification.passport_available || !!(draft.identification.passport_number && draft.identification.passport_expiry),
    draft.education.every(item => !!item.institution.trim() && !!item.qualification.trim()),
    draft.experience.every(item => !!item.employer.trim() && !!item.position.trim()),
    true, !missingDocs.length, job.questions.every(q => !q.required || !!draft.answers[q.id]?.trim()),
  ];
  return <div className="grid lg:grid-cols-[240px_1fr] gap-6"><aside><Card><p className="font-bold">Application progress</p><progress className="w-full my-3" max={7} value={sections.filter(Boolean).length} aria-label="Sections completed"/><p className="muted text-sm">{Math.round(sections.filter(Boolean).length / 7 * 100)}% of required sections ready</p><ol className="grid gap-2 mt-5">{steps.map((name,i) => <li key={name}><button type="button" className={`text-left w-full rounded-lg p-2 text-sm ${step === i ? "bg-blue-50 text-primary font-bold" : ""}`} aria-current={step === i ? "step" : undefined} disabled={busy} onClick={() => void action(async () => setStep(i))}>{i+1}. {name}{i < 7 && <span className="block text-xs muted">{sections[i] ? "Ready" : "Incomplete"}</span>}</button></li>)}</ol></Card></aside>
    <Card><div role="status" className="muted text-sm mb-4">{message}</div>{error && <Alert error>{error}</Alert>}<h2 className="text-2xl font-bold my-6">{steps[step]}</h2><fieldset disabled={busy} className="min-w-0">
      {step === 0 && <Fields values={draft.personal} onChange={(key,value) => update({ ...draft, personal: { ...draft.personal, [key]: value } })}/>}
      {step === 1 && <div className="grid gap-5"><label className="flex gap-3"><input type="checkbox" checked={draft.identification.passport_available} onChange={e => update({ ...draft, identification: { passport_available: e.target.checked, passport_number: "", passport_expiry: "" } })}/>I have a passport</label>{draft.identification.passport_available && <Fields values={{ passport_number: draft.identification.passport_number, passport_expiry: draft.identification.passport_expiry }} onChange={(key,value) => update({ ...draft, identification: { ...draft.identification, [key]: value } })}/>}</div>}
      {(step === 2 || step === 3) && <div className="grid gap-6"><p className="muted">Add relevant records. If you have none, continue to the next step.</p>{draft[section].map((record,index) => <div className="border border-slate-200 rounded-xl p-4 grid gap-4" key={index}><Fields values={record} onChange={(key,value) => update({ ...draft, [section]: draft[section].map((item,i) => i === index ? { ...item,[key]: value } : item) })}/><Button type="button" className="secondary" onClick={() => update({ ...draft,[section]: draft[section].filter((_,i) => i !== index) })}>Remove record {index+1}</Button></div>)}<Button type="button" className="secondary" disabled={draft[section].length >= (step === 2 ? 20 : 30)} onClick={() => update(step === 2 ? { ...draft, education: [...draft.education,{ institution: "", qualification: "", field: "", country: "", start_date: "", completion_date: "" }] } : { ...draft, experience: [...draft.experience,{ employer: "", position: "", location: "", start_date: "", end_date: "", responsibilities: "" }] })}>Add {section === "education" ? "education" : "work experience"}</Button></div>}
      {step === 4 && <><h3 className="text-xl font-bold">{job.title}</h3><p className="muted mt-3">{employerLabel(job.company)}</p><p className="mt-5">Your voucher was activated for this CruiseApply screening opportunity.</p><p className="mt-5 text-sm leading-6">{job.service_description}</p></>}
      {step === 5 && <div className="grid gap-5"><p className="muted">PDF, JPEG or PNG, up to 10 MB per file. Maximum 20 documents. {job.required_documents.length ? `Required: ${job.required_documents.join(", ")}.` : "No mandatory documents are configured for this vacancy."}</p><label className="field">Document kind<select id="upload-kind" defaultValue="cv">{["cv","passport","certificate","photo","supporting"].map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}</select></label><label className="field">Choose a document<input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={documents.length >= 20} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        const kind = (document.getElementById("upload-kind") as HTMLSelectElement).value;
        void action(async () => {
          if (file.size > 10485760 || !file.size) throw new Error("Choose a file up to 10 MB.");
          const response = await fetch(`${apiBase}/${id}/documents?${new URLSearchParams({ kind,name: file.name,revision: String(revision.current) })}`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
          const result = await response.json(); if (!response.ok) throw new Error(result.error);
          revision.current = result.revision; setDocuments(items => [...items,result.document]); setDeclaration(false);
        });
      }}/></label>{documents.map(doc => <div key={doc.id} className="border-t border-slate-100 pt-4 flex flex-wrap justify-between gap-3"><a className="text-primary break-all" href={`${apiBase}/${id}/documents/${doc.id}`}>{doc.name} ({doc.kind})</a><button type="button" className="text-red-700 text-sm" onClick={() => void action(async () => {
        const result = await sendJson<Saved>(`${apiBase}/${id}/documents/${doc.id}`, { revision: revision.current }, "DELETE"); revision.current = result.revision; setDocuments(items => items.filter(item => item.id !== doc.id)); setDeclaration(false);
      })}>Remove {doc.name}</button></div>)}</div>}
      {step === 6 && <div className="grid gap-5">{job.questions.length ? job.questions.map(q => <label className="field" key={q.id}>{q.label}{q.required ? " (required)" : " (optional)"}<textarea rows={4} maxLength={5000} value={draft.answers[q.id] ?? ""} onChange={e => update({ ...draft,answers: { ...draft.answers,[q.id]: e.target.value } })}/></label>) : <p className="muted">No additional questions for this vacancy.</p>}</div>}
      {step === 7 && <ApplicationReview draft={draft} documents={documents}/>}
      {step === 8 && <div className="grid gap-5">{!complete.success && <Alert error>{complete.error.issues.slice(0,5).map((issue,i) => <p key={i}>{issue.path.join(" · ")}: {issue.message}</p>)}</Alert>}{!!missingDocs.length && <Alert error>Upload required documents: {missingDocs.join(", ")}</Alert>}<p>Review every section before submitting to CruiseApply for screening. Your submitted application will be read-only. Employer referral and hiring are separate later decisions.</p><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={declaration} onChange={e => setDeclaration(e.target.checked)}/>I have reviewed my application and confirm that the information and documents I provided are accurate.</label><Button type="button" disabled={!declaration || !complete.success || !!missingDocs.length} onClick={() => void action(async () => { await sendJson(`${apiBase}/${id}/submit`, { revision: revision.current, declaration: true }); router.refresh(); })}>Submit to CruiseApply</Button></div>}
    </fieldset><div className="flex flex-wrap gap-3 mt-8 border-t border-slate-100 pt-6"><Button type="button" className="secondary" disabled={busy || step === 0} onClick={() => void action(async () => setStep(step-1))}>Back</Button><Button type="button" className="secondary" disabled={busy} onClick={() => void action(async () => {})}>Save progress</Button>{step < steps.length-1 && <Button type="button" disabled={busy} onClick={() => void action(async () => setStep(step+1))}>Save & continue</Button>}</div></Card></div>;
}
