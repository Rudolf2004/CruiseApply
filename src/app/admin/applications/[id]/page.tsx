import Link from "next/link";
import { CandidateMatching } from "@/features/matching/candidate";
import { listStaffResponses } from "@/features/applicant-actions/staff";
import { StaffNoteForm } from "@/features/staff-notes/form";
import { listStaffNotes } from "@/features/staff-notes/service";
import { StaffReviewForm } from "@/features/admin-review/form";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { loadStaffApplication } from "@/features/applications/service";
import { ApplicationReview } from "@/features/applications/wizard";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
export default async function AdminApplication({ params,searchParams }: { params: Promise<{ id: string }>;searchParams: Promise<{ notesPage?: string; responsesPage?: string }> }) {
  const { db } = await requireUser(true); const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const owner = await db.from("applications").select("user_id").eq("id",id).maybeSingle();
  if (owner.error) throw new Error("Candidate lookup unavailable."); if (!owner.data) notFound();
  const application = await loadStaffApplication(id);
  const requestedPage = Number((await searchParams).notesPage ?? 1);
  const notesPage = Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
  const notes = await listStaffNotes(db,id,notesPage);
  const responseNumber=Number((await searchParams).responsesPage??1);
  const responsesPage=Number.isInteger(responseNumber)&&responseNumber>0&&responseNumber<=10000?responseNumber:1;
  const responses=await listStaffResponses(db,id,responsesPage);
  return <section><PageHeader title={`Candidate ${application.reference}`} description={application.opportunity_title_snapshot || application.job.title}><StatusBadge status={application.status}/></PageHeader><div className="grid gap-6"><Card><h2 className="text-xl font-bold mb-4">Screening decision</h2><StaffReviewForm key={application.revision} id={id} status={application.status} revision={application.revision}/></Card><Card><h2 id="staff-notes" className="text-xl font-bold mb-4">Private staff notes</h2><StaffNoteForm id={id} revision={application.revision}/><div className="grid gap-4 mt-6">{notes.notes.length ? notes.notes.map(note => <article key={note.id} className="border-t pt-4"><p className="whitespace-pre-wrap break-words">{note.body}</p><p className="muted text-xs mt-2">Staff {note.actor_id} | {new Date(note.created_at).toLocaleString("en-GB",{ timeZone: "UTC" })} UTC | Context revision {note.context_revision ?? "Not recorded"}</p></article>) : <p className="muted">No internal notes on this page.</p>}</div><nav aria-label="Staff notes pages" className="flex gap-4 mt-4">{notesPage > 1 && <Link href={"?notesPage="+(notesPage-1)+"#staff-notes"}>Newer notes</Link>}{notesPage*20 < notes.total && <Link href={"?notesPage="+(notesPage+1)+"#staff-notes"}>Older notes</Link>}</nav></Card><Card><h2 id="applicant-replies" className="text-xl font-bold mb-4">Applicant replies and withdrawal</h2>{!responses.available?<p>Applicant replies become available after migration 0013.</p>:responses.items.length?responses.items.map(reply=><article key={reply.request_id} className="border-t py-4"><p className="font-semibold">{reply.operation==="withdraw"?"Applicant-requested withdrawal":"Additional information"}</p><p className="muted text-xs">{new Date(reply.created_at).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</p><p className="whitespace-pre-wrap break-words mt-3">{reply.body}</p>{reply.documents.map(doc=><a key={doc.id} className="block text-primary underline" href={`/api/admin/applications/${id}/documents/${doc.id}`}>{doc.name}</a>)}</article>):<p>No replies on this page.</p>}<nav aria-label="Applicant reply pages" className="flex gap-4 mt-4">{responsesPage>1&&<Link href={`?responsesPage=${responsesPage-1}#applicant-replies`}>Newer replies</Link>}{responsesPage*20<responses.total&&<Link href={`?responsesPage=${responsesPage+1}#applicant-replies`}>Older replies</Link>}</nav></Card><Card><h2 className="text-xl font-bold mb-3">Employer matching</h2><CandidateMatching id={id} status={application.status} documents={application.documents}/></Card><Card><ApplicationReview draft={application.draft} documents={application.documents}/><div className="grid gap-3 mt-5">{application.documents.map(doc => <a key={doc.id} className="text-primary underline" href={`/api/admin/applications/${id}/documents/${doc.id}`}>Download for review: {doc.name}</a>)}</div><p className="muted text-xs mt-3">Staff document downloads are recorded in the audit log.</p></Card><Card><h2 className="text-xl font-bold mb-4">Status history</h2>{application.history.map((entry,i) => <p key={i} className="my-3">{entry.status.replaceAll("_"," ")} — {entry.message}</p>)}</Card></div></section>;
}
