# Managed application E2E — September 30, 2026

The owner applied migrations 0004 and 0005 and approved the genuine **Hospitality & Guest Services — Candidate Screening** intake. It is managed by CruiseApply, has no employer assigned, and has no mandatory documents, configured questions, extra age/eligibility rules, salary, ship assignment, contract offer or openings. The four researched Carnival entries remain unpublished `draft/research` rows.

## Verified application

- Original voucher: `CRV-2026-00000003`, retained under its original owner, now `used`.
- Application: `APP-2026-00000001` (`a05a32bf-c510-4020-a551-4164360b6282`).
- Submitted through the browser's review/declaration flow at `2026-09-30T14:02:12.456345+00:00`.
- Exactly one application; current status `submitted`, revision 8.
- One education record, one experience record, two optional test PDF uploads from resumed test runs. The submitted documents remain private and are retained as part of the test application.
- No employer assignment or match was fabricated: zero `application_matches`.
- Original payment remains successful at 15000 pesewas/GHS. No additional Paystack transaction or payment record was initialized.

## Checks completed before submission

The normal redemption endpoint verified the original owner's PIN and recovered the same application for concurrent requests. Two saves carrying the same revision produced one success and one conflict. The browser resumed saved personal data after reload and displayed the education/experience data for review. Invalid file contents were rejected; a validated optional PDF uploaded privately and downloaded with attachment disposition. Anonymous document access was denied. Declaration was required, and the browser displayed receipt by CruiseApply for screening after submission.

Repeated submissions returned the existing reference; post-submission saves and document deletion were rejected. Service-description snapshots resisted mutation. Status history contains draft and submitted; notifications contain one each of Voucher ready, Application started and Application submitted.

The first test interruption was caused by a second verification runner signing the same applicant out globally. Test cleanup now uses local-session sign-out. The draft survived. Later local development compilation/filesystem delays caused test timeouts; browser verification continued against the production build. No credentials, ownership checks or database invariants were bypassed.

## Final access review

Final verification passed in `scripts/verify-submitted-application.mts` against the production build on port 3001. Original-owner login, two concurrent submission replays, the submitted read-only page and dashboard reference all passed. Foreign applicants could not read the candidate through the application page, document endpoint, direct database query or admin screen. A temporary database-role admin could review the candidate and the unassigned employer-matching state; the applicant-only document endpoint continued to deny that admin access.

Hosted counts were exactly one original payment voucher, one Voucher ready notification, one Application started notification, one Application submitted notification, one submitted-history entry and one application_submitted audit entry attributed to the original owner. There was one application and zero employer matches. The original payment remained successful at 15000/GHS. Replays returned APP-2026-00000001 without creating duplicates.

Both leftover review fixtures from the interrupted run were removed after confirming they had no payment, voucher or application records. The final run also removed both of its disposable access-test accounts successfully (exit code 0). Cleanup now validates each response and includes the actual error instead of masking it with a generic message. The earlier generic cleanup failure did not retain enough detail to establish its original cause; a subsequent restricted-network attempt reported fetch failure, and approved network access allowed cleanup to succeed.

Production compilation, TypeScript validation, static generation and build completed successfully. Lint passed; all 56 unit tests across 11 files passed. Hosted workflow boundary checks passed again. Local development-server interference and a 120-second browser navigation timeout were handled by using a dedicated production server and longer test timeouts, without changing application authorization. The applicant page, admin review screenshots and non-secret summary are in ignored test-results files.

Next.js can return HTTP 200 for a streamed not-found page. Access tests therefore check both the not-found content and absence of applicant details, while document API denial must return 404. This follows the installed Next.js not-found convention; no authorization behavior was weakened.

## Scope and remaining work

The admin candidate-review screen supports reviewing the submitted profile, history and unassigned matching state. Internal screening decisions, including shortlisting and internal acceptance, are now implemented and verified through migration 0006; see [staff review results](STAFF-REVIEW-E2E.md). Employer-opportunity management and audited referral actions remain future work. No real employer application or referral was transmitted.

Required-document and configured-question validation remain supported; this approved intake intentionally has neither. Do not add those requirements to make a test pass. Database upload/submission race testing and operational orphan-file reconciliation are not implied by the successful sequential optional-upload flow.

Actual Paystack webhook delivery still requires a publicly reachable HTTPS application endpoint. Paystack remains Test Mode only. Follow [the exact manual Test Mode setup](PAYSTACK-WEBHOOK-TEST.md). No migration needs to be reapplied.
