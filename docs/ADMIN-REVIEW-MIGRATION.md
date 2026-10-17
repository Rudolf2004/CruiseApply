# Migration 0006: internal candidate review (applied)

File: [202609300006_admin_review.sql](../supabase/migrations/202609300006_admin_review.sql).

The owner manually applied this additive migration. Migrations 0001-0006 remain applied and unchanged. Notification reading, tracking and document downloads use the existing schema and do not depend on 0006.

## Applied guarantees

The service-only review_application RPC checks the authenticated staff actor supplied by the server against the database role, locks the role/application, checks the expected application revision, and commits status, applicant-visible history, notification and staff-attributed audit together. An immutable request record makes identical retries return the original result; a reused request ID with different input fails. The server must derive actor_id from its verified session, never from the request body.

Allowed transitions:

| Current status | Allowed next status |
| --- | --- |
| submitted | under_review |
| under_review | additional_information_required, shortlisted, unsuccessful |
| additional_information_required | under_review |
| shortlisted | interview, final_review, unsuccessful |
| interview | final_review, unsuccessful |
| final_review | accepted, unsuccessful, additional_information_required |
| accepted, unsuccessful, withdrawn | None |

Every decision requires a 10-2000 character applicant-visible message. These are internal CruiseApply screening statuses. Accepted means accepted/qualified through CruiseApply's internal screening. It does not mean hired, employed or selected by a cruise company, and does not guarantee employer referral. Applicant status guidance and accepted-status notifications explicitly explain this. Interview must explain who is conducting it. Terminal decisions cannot be reopened by this RPC.

Withdrawal is applicant-driven and is not an allowed destination in any normal admin review transition. A separate protected withdrawal operation will be implemented later with its own history and audit handling. Any future staff operation recording an applicant-requested withdrawal must explicitly preserve that distinction; review_application cannot be used for it.

Additional-information status does not unlock submitted documents or personal details. The staff message must explain the actual available response channel; no new response channel or email integration is invented here. Document reopening, applicant replies and employer referral actions need their own implementation.

## Implementation and verification

Do not rerun migration 0006. The protected staff UI/API, filtered queue and separately audited private document downloads are implemented. Hosted authorization, transition, revision, concurrency, audit and owner-visibility checks passed. See [staff review results](STAFF-REVIEW-E2E.md).

The next schema proposal is [internal staff notes](STAFF-NOTES-MIGRATION.md), which remains unapplied and requires manual review.
