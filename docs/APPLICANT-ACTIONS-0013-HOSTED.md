# Migration 0013: fully hosted-verified

The owner's saved `verification_0013.json` exactly matches the locally executed migration: five function definitions/security settings/permissions, nine private tables, ownership columns, constraints, indexes, triggers and policies. The documented PostgreSQL NOT NULL representation difference is normalized; all 220 required columns were independently checked against hosted OpenAPI metadata.

Hosted tests passed on 2026-10-04:

- Anonymous/authenticated RPC denial and staff-only response-table RLS; staff-role removal hides reply rows.
- Six concurrent identical replies produce one operation and one notification/audit. Changed payloads, foreign applications and stale revisions fail.
- Actual private attachment upload, stored MIME/size validation, scoped registration/download authorization and staff visibility.
- Six concurrent identical withdrawals produce one withdrawal. Terminal reopening is denied; applicant tracking remains available.
- Guest purchase/claim database fixtures, application/document/submission/staff-review/notification/logout regressions pass.
- All fixtures removed; all public-table snapshots match their pre-test state. Original payment, voucher, application and staff data remain unchanged.

Evidence: `test-results/applicant-actions-0013-catalog-comparison.json`, `test-results/applicant-actions-0013-hosted.json` (`passed=true`, `cleaned=true`). Source catalog SHA-256: `c076b63a87ccc1b4e3596357223675274bdd7f0a6d0780fc42bd30572e6c2fb8`.

No Paystack API call, external email, applicant rollout or original-record modification occurred. Synthetic payment fixture fulfillment tests the trusted database boundary, not a real provider transaction. The complete enabled browser journey remains a controlled release-stage test.
