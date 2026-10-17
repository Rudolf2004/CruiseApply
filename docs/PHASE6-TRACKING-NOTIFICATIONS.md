# Phase 6: applicant tracking and in-app notifications

Implemented and verified on September 30, 2026. This work does not depend on the Cloudflare tunnel or migration 0006.

## Delivered

- Dashboard links to applications, available vouchers and unread updates, with profile essentials and status-specific next steps.
- Application status filters, pagination, saved opportunity titles and an ordered timeline of recorded status changes. Future stages are not shown as completed.
- Paginated notifications with all/unread views, unread counts, safe internal links and explicit mark-as-read controls.
- Owner-derived notification mutations; the first read timestamp is retained on repeat/concurrent requests. No authenticated-client direct write policy was added.
- Paginated private document index using the existing owner-only download endpoint.
- Internal screening wording that does not turn a CruiseApply status into an employer job offer.

This is in-app notification delivery. No email/SMS provider or outbound message integration was enabled. Admin-created status updates are now implemented against applied migration 0006; see [staff review results](STAFF-REVIEW-E2E.md).

## Verification

TypeScript, lint, 62 unit tests across 12 files, and the production build passed.

The hosted/browser runner `scripts/verify-notifications.mts` passed:

- anonymous requests denied; wrong Origin denied; foreign notification IDs return 404;
- applicant RLS prevents foreign notification reads and direct authenticated REST mutations;
- browser mark-as-read changes the unread count;
- concurrent/repeated reads preserve the first timestamp;
- unsafe external notification links are suppressed;
- 390px mobile layout has no horizontal overflow; screenshot visually inspected;
- the original applicant can filter APP-2026-00000001 by submitted status, follow dashboard links and download its two private documents;
- all disposable users and notification records were removed successfully.

No original application, payment, voucher or notification state was changed by this runner. No new Paystack checkout, employer match or external referral was created.

Ignored artifacts: phase6-typecheck.log, phase6-lint.log, phase6-tests.log, phase6-build.log, phase6-hosted.log and notifications-mobile.png under test-results.

## Next dependency

Migration 0006 and the staff action UI/API are implemented and verified. Do not rerun it. The next manual review dependency is [migration 0007 for private staff notes](STAFF-NOTES-MIGRATION.md).

The Paystack webhook test remains independent. The current verified production server uses http://localhost:3000, matching NEXT_PUBLIC_APP_URL. Use this port for the Cloudflare tunnel; see [webhook instructions](PAYSTACK-WEBHOOK-TEST.md).
