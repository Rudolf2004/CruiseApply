# 0016 hosted verification — PASS

The owner applied 0016. The full saved catalog matches the exact reviewed SQL, including both complete function definitions, ownership/security configuration, grants, RLS, constraints and indexes. Hosted metadata confirmed all 243 NOT NULL columns.

Hosted tests passed service-only and super-admin authorization, six identical pricing requests, exactly one attributed audit, stale expected-row and payload-conflict rejection, inactive region/override writes, invalid FX/contact rejection, export auditing and revoked-role denial. The administration controls regression also passed.

All fixtures were removed; before/after hashes of every original public table matched. Actual rates, country mappings, public contacts and approved product prices were unchanged. No Paystack call or applicant rollout occurred.

Evidence: test-results/pricing-controls-0016-catalog-comparison.json and pricing-controls-0016-hosted.json. Positive FX/contact cases were tested only in isolated local PostgreSQL; no fabricated hosted rate or contact was inserted.

The corrected application passed the production build, TypeScript, full lint and 185 unit tests. Earlier disabled-boundary desktop/mobile checks passed. Authenticated staff-browser verification is recorded separately below; it is not implied by RPC tests.

## Staff pricing read boundary

Authenticated browser testing exposed that the pricing editor used a staff RLS client against configuration tables whose direct authenticated SELECT grants are intentionally revoked. The editor and allowlisted pricing record/export loaders now use server-only reads after the caller's authenticated database session passes `is_admin()`. The editor additionally retains its super-admin requirement. This changes no database grant or RLS policy. Payment, voucher, application and audit reads retain their existing RLS client. Regression tests cover denial before service-client creation, allowed pricing tables and unchanged payment reads. The rebuilt application passed the real staff login, 390px/1440px record/report views, audited CSV export, inactive product edit, inactive region save and identical retry. The final redirect assertion was corrected to await Next.js navigation. The complete rerun passed, including anonymous pricing-export denial, staff-role revocation, nonstaff export denial and access-denied navigation. All disposable fixtures were removed and every original public-table snapshot matched. Evidence: `test-results/admin-controls-browser.json` (`passed: true`, `cleaned: true`). No applicant rollout, email or Paystack call occurred.
