# Private staff notes verification

## Implementation

Applied migration 0007 is used by the staff-only candidate notes editor and `/api/admin/applications/[id]/notes` GET/POST routes. Staff reads use an authenticated Supabase client and RLS. The write route obtains the actor exclusively from its verified session and rejects unknown fields through a strict schema. Notes have 10-5000 characters, a UUID request ID and an application revision context.

The paginated staff list shows note text, staff ID, timestamp and context revision. React renders note text without HTML interpretation. The form preserves the payload/request ID when confirmation is interrupted. Private notes remain separate from the shared applicant application loader.

## RLS policy review

The foundation enables RLS on `admin_notes`. Its only declared read policy is `notes_admin_read`, for SELECT to authenticated users with `public.is_admin()`. The helper checks the current profile role for admin/super_admin; it does not trust user-supplied metadata. There is no applicant-owner exception and no authenticated write policy. Later migrations preserve this policy; 0007 adds only a column and service-only write RPC.

Hosted behavior is tested directly with anonymous, applicant and staff clients, including note-ID reads, application-scoped reads, embedded application-to-notes reads and staff-role revocation. This combines review of the checked-in policy definitions with effective hosted RLS tests; it is not a claim that the live PostgreSQL policy catalog was queried through REST.

## Validation

TypeScript, full lint and all 80 unit tests passed. Hosted RPC checks passed for anonymous/authenticated direct RPC denial, non-admin actor denial, stale revision rejection, six identical concurrent retries, conflicting request IDs, staff/super-admin reads and role revocation. Exact audit assertions verified one generic insert and one attributed event, neither containing note text. Application, revision, history, notification and matching snapshots remained unchanged. Temporary fixtures were removed.

The final production build and hosted/production-browser verification passed on October 2, 2026. Browser checks covered staff-only GET/POST access, spoofed actor and foreign-origin rejection, stale/conflicting requests, list pagination, saving a note, losing the response after commit and retrying the identical request. Exactly two test notes produced two generic insert audits and two explicit staff-attributed audit events, with no applicant-side effects.

Applicant dashboards, application pages/serialized content and notifications contained no private note text. The PATCH-only application API correctly refused GET with 405 and returned no note data. Anonymous and applicant access to staff pages/APIs was denied. Original-owner visibility and cross-owner isolation passed; the original application remained unchanged. A 390px mobile screenshot and overflow assertion passed.

The hosted test exposed an out-of-range pagination error (PGRST103), now handled as an empty page using an authenticated, application-scoped count. Regression tests cover that behavior and preserve failures for other database errors. An earlier run timed out reading the notifications page; the final full run passed with a longer response timeout. Temporary fixture accounts and rows were removed after every completed run. Browser failure reporting now omits session diagnostics.

No additional migration or external service is required for staff notes. Original payment/voucher/application records were not modified and no employer match or Paystack transaction was created. The separate [provider-origin webhook delivery test](PAYSTACK-WEBHOOK-TEST.md) remains pending because Paystack has no recorded event for the original transaction.
