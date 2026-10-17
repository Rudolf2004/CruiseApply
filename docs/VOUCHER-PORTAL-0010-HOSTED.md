# 0010 hosted verification: PASS

Verified 2026-10-03. The complete supplied catalog matches the exact locally tested migration: 12 function definitions/signatures/owners/security configurations and permissions, 14 owner columns, eight private-table RLS/permission entries, and the notification trigger. Comparator: `scripts/compare-voucher-portal-catalog.mts`; evidence: `test-results/voucher-portal-0010-catalog-comparison.json`.

Hosted behavioral runner: `node --env-file=.env.local scripts/verify-voucher-portal-hosted.mts`. Evidence: `test-results/voucher-portal-0010-hosted.json` and `test-results/voucher-portal-hosted.log`.

- All nine portal RPCs deny anonymous, authenticated applicant and authenticated staff execution. Private auth tables deny direct access; the internal helper also denies direct service-role execution.
- Six concurrent redemptions create one application. Six saves at the same revision admit one. Two vouchers sharing an owner/contact remain separate scopes; another applicant's RLS and RPC access fails.
- Real private Storage upload/download passed, with anonymous and foreign-applicant denial. An upload/submission race admitted one operation; six submission retries left one submission history/principal audit event.
- Concurrent staff review and eight portal loads completed without deadlock. Staff notes remained private; linked notifications stayed voucher-scoped; six mark-read calls retained one timestamp.
- Logout/write and credential-version/write races cannot authorize subsequent requests. Used-voucher ordinary expiry and payment refund retain tracking; refunded edits fail. Principal audit metadata contains no private payload.
- All temporary users, objects and database fixtures were removed. Full before/after digests match across legacy, application children, payment/voucher, staff-review/audit and all eight 0008 tables. Original baseline: 2 profiles, 3 payments, 2 vouchers, 1 application, 2 documents, 4 notifications. No Paystack calls, original-record mutation or rollout.

0010 is fully hosted-verified for its database scope. The browser portal integration and guest principal ownership are subsequent implementation stages; this verdict does not imply those are already complete. The catalog export is a point-in-time observation, not a replacement for later regression testing when schema changes.
