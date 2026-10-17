# Staff review verification

Completed against hosted Supabase and the production application on October 2, 2026. Migration 0006 was applied manually by the owner and was not reapplied.

## Delivered

- Staff-only review UI/API, with actor identity derived from the authenticated session and database admin/super_admin authorization.
- Revision-aware decisions, stable request IDs for uncertain retries and applicant-visible messages.
- Reference/status filters, sorting and pagination in the staff application queue.
- Separate staff document download endpoint with an attributed audit entry required before serving the private file. Applicant-only download permissions remain unchanged.
- Withdrawal excluded from review decisions. Acceptance explicitly means internal CruiseApply qualification, without employment or guaranteed referral.

## Passed checks

TypeScript, lint, all 71 unit tests across 14 files and the production build passed.

The hosted runner `scripts/verify-staff-review.mts` and production-browser checks passed:

- Anonymous and authenticated direct RPC denial; non-staff actor denial; role revocation, admin and super_admin checks.
- Draft, invalid transition, invalid message, stale revision, withdrawal and terminal reopening rejection.
- Six concurrent identical requests produced one command, history entry, notification and attributed review audit event.
- Reusing a request ID with changed input failed. Two different concurrent decisions against one revision produced one success and one revision conflict.
- API rejected anonymous/applicant requests, foreign origins, forged actor fields and withdrawal.
- Browser-recorded staff decision appeared in candidate history, with exact corresponding notification/audit counts.
- Staff queue filtering and private document access passed; the download generated one staff-attributed audit event and denied applicant access to the staff endpoint.
- Valid progression to internal acceptance, acceptance notification/owner wording, repeated acceptance verification and terminal rejection passed without duplicate writes.
- Original-owner application history remained accessible; foreign-applicant RLS isolation held. Original APP-2026-00000001 status, revision and submission timestamp were unchanged.

One earlier browser run redirected the fixture applicant to login. The complete rerun passed without changing application authentication or authorization. The runner now fails promptly on this redirect rather than waiting for missing page content. Earlier selector/timing assertions were also corrected to wait for the actual review response before checking committed counts.

Temporary accounts and synthetic application/payment/voucher records were removed. Synthetic payment fixtures did not invoke Paystack or represent successful purchases. No new Paystack transaction, original application decision, employer match or external referral was created. Test Mode remains unchanged.

## Remaining dependencies

The owner applied [migration 0007](STAFF-NOTES-MIGRATION.md). The private notes editor and hosted/browser checks are now complete; see [staff notes results](STAFF-NOTES-E2E.md).

Public HTTPS webhook checks passed, but actual Paystack-origin delivery still needs a recorded provider event; see [the webhook test guide](PAYSTACK-WEBHOOK-TEST.md). Employer referral actions, applicant withdrawal and remaining administrative management remain separate work.
