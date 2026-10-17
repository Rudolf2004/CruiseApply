# Migration 0007: internal staff notes (applied)

The owner manually applied [202610010007_staff_notes.sql](../supabase/migrations/202610010007_staff_notes.sql). Do not rerun migrations 0001-0007.

The private notes editor and paginated notes list are available on the protected staff candidate page. The notes API checks the verified staff session; the browser cannot choose the actor. Reads use the authenticated RLS client. Writes use the service-only `add_application_note` RPC.

The operation checks the current database admin/super_admin role, locks the role/application, checks the application revision context and uses the note UUID as an idempotency key. Identical retries return the original note; conflicting payloads fail. A note does not change the application status or revision and creates no applicant history or notification.

Each note produces the foundation's generic insert audit plus one explicit staff-attributed `application_note_added` event. Neither contains the private note body. Existing notes keep their null context revision and remain readable by authorized staff.

The editor preserves its request ID and payload after an uncertain network/server result so retrying confirms the same note. Notes are plain text and are not included in applicant application payloads or screens.

See [staff notes verification](STAFF-NOTES-E2E.md) for check results and remaining external dependencies. No migration was automatically applied and no withdrawal or employer-referral operation was added.
