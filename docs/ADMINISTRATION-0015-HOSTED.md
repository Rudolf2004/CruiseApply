# 0015 hosted verification — PASS

The owner applied 0015. The entire verification_0015.json catalog matched the reviewed local migration, including function body/security/grants, table RLS, constraints, indexes and columns. Hosted metadata confirmed 237 NOT NULL columns.

The final full run passed service-only access, staff/super-admin restrictions, revoked-role RLS, six concurrent same-request saves, one attributed audit, stale revision and payload-conflict rejection. The temporary intake remained draft and the temporary product inactive. All fixtures were removed and every original public-table snapshot matched.

An earlier cleanup encountered intermittent network fetch failures. Targeted cleanup removed its recorded fixtures; a fresh complete run then passed. IPv4-first resolution and bounded GET/DELETE retries were added to the test runner. No production application behavior was changed to bypass a database failure.

Evidence: test-results/administration-0015-catalog-comparison.json, administration-0015-hosted.json, administration-hosted-baseline.json and administration-hosted-fixtures.json. No Paystack calls, applicant rollout or original-product mutation. Enabled authenticated staff browser editing remains part of final E2E; these results describe the hosted RPC/RLS checks.
