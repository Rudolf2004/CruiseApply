> Current voucher-auth status (2026-10-11): 0008, 0009, 0010, 0011, 0012, 0013, 0014, 0015 and 0016 are fully hosted-verified, including exact function-catalog comparison. The [server PIN/cookie boundary](APPLICANT-AUTH-SERVER-BOUNDARY.md) is prepared behind a disabled rollout switch. 0010 hosted catalog/security/isolation/concurrency checks passed; no applicant-auth cutover has occurred. See [0009 evidence](VOUCHER-SESSION-0009-HOSTED.md). Earlier pre-application notes below are historical.

# Implementation status

This file records actual delivery, not planned features as completed work. The current work order below follows the owner's updated Phase A-L plan; the numbered sections afterward record earlier delivery checkpoints.

## Current work order (2026-10-11)

| Workstream | Status | Remaining work / next dependency |
| --- | --- | --- |
| 0008 expansion and 0009 session operations | Complete | Exact hosted catalog and disposable-fixture checks recorded in the linked verification documents. |
| Server Serial/PIN and cookie boundary | Complete, disabled | Implemented and locally verified; connected to the disabled applicant portal; rollout remains off. |
| A: voucher-scoped portal | In progress | 0010 applied and [fully hosted-verified](VOUCHER-PORTAL-0010-HOSTED.md); Disabled portal UI/API adapters implemented; regression and disabled-route desktop/mobile browser checks passed. Full enabled journey follows recovery dependencies. |
| B: guest purchase and initial credential claim | In progress | [0011 review package](GUEST-CHECKOUT-MIGRATION.md) and disabled purchase/claim boundary prepared; local SQL checks passed. [0011 hosted catalog, isolation and claim concurrency verification passed](GUEST-CHECKOUT-0011-HOSTED.md); all fixtures removed. |
| C: verified email PIN reset | Implemented, disabled; hosted verification passed | [0012 review package](VOUCHER-PIN-RECOVERY-MIGRATION.md), server/UI and optional Resend adapter prepared. [0012 hosted checks passed](VOUCHER-RECOVERY-0012-HOSTED.md); actual sender/mailbox verification remains pending. |
| D: applicant responses and withdrawal | Implemented, disabled; hosted verified | [0013 reply/withdrawal review](APPLICANT-ACTIONS-MIGRATION.md), scoped API/UI, private attachments and staff review prepared. Local SQL and 156 unit tests passed; [0013 hosted verification](APPLICANT-ACTIONS-0013-HOSTED.md) passed with full fixture cleanup. |
| E: legitimate employer matching/referral | Implemented; 0014 catalog and safe hosted checks passed | [Employer/matching/consent review](EMPLOYER-MATCHING-MIGRATION.md): staff UI/API, employer-specific applicant consent and referral recording prepared. No automatic transmission or fabricated hosted matches. Local SQL and 166 tests passed; [Hosted tests passed](EMPLOYER-MATCHING-0014-HOSTED.md); positive referral E2E requires a legitimate opportunity. |
| F: admin management | 0015–0016 hosted verified | Intake/product and regional pricing/public-contact controls implemented and RPC-tested. Authenticated staff-browser checks passed; final release UX review remains. |
| G: reports and audit tools | Implemented initial views | Operational counts, paginated staff audit view and allowlisted page CSV exports implemented. Export-event audit implemented and hosted-verified in 0016; financial provider reconciliation remains separate. |
| H: transactional email | Recovery transport prepared; external configuration required | Verified sender and actual mailbox delivery remain pending; other approved operational messages remain. No SMS/WhatsApp. |
| I: provider-origin Test Mode webhook | Blocked on external delivery | Synthetic signature/forgery/replay checks passed. Stable HTTPS endpoint and a genuine Paystack-origin event still required; no new transaction authorized now. |
| J: complete voucher-auth E2E | Not started | Existing legacy E2Es remain valid for their tested scope; repeat the complete new journey only after A-I dependencies. |
| K: final quality/security/accessibility | In progress | Existing tests retained; complete cross-voucher, concurrency, responsive, accessibility and release regression checks. |
| L: production readiness | Checklist prepared | [Controlled release checklist](CONTROLLED-RELEASE-CHECKLIST.md) prepared; actual deployment, monitoring, backup/restore verification and final policies remain. Live Mode remains unapproved. |

Applicant rollout remains disabled. Applied migrations 0008-0010 do not by themselves finish guest checkout, recovery, or the applicant-auth cutover. 0010 catalog and hosted authorization, isolation, concurrency, private storage and preservation checks passed; all temporary fixtures were removed. Development continues directly into the portal and guest-checkout dependencies.

0010 preparation passed exact local PostgreSQL execution, eight integration check groups, read-only catalog validation, TypeScript, lint, all 102 unit tests and the production build. Its subsequent hosted verification passed. Browser portal checks follow adapter implementation. No Paystack transaction was created.

### Current guest-checkout checkpoint

0011 was manually applied and is [fully hosted-verified](GUEST-CHECKOUT-0011-HOSTED.md). Guest purchase and callback/status routes, one-time Serial/PIN claim, secure cookie boundary, scoped portal pages, private documents, notifications and receipt are implemented behind the unchanged disabled rollout. Staff application loading supports either immutable ownership form after verified staff authentication. Paystack verification remains the fulfillment gate; new principal vouchers store no retrievable PIN credentials.

Validation: TypeScript, lint, all **132 tests**, production build and exact local SQL/catalog validation passed. The separate production-server smoke test passed HTTP guards and headless Edge checks at 390px and 1440px: disabled applicant/guest pages expose no credential form and APIs issue no cookies or credentials. Next streamed not-found pages can return HTTP 200 with the not-found UI; API denial remains HTTP 404. These are disabled-boundary checks, not a claim that the full enabled guest journey or accessibility audit is complete.

0011 and [0012 hosted checks](VOUCHER-RECOVERY-0012-HOSTED.md) passed with complete fixture cleanup and original-record preservation. No Paystack transaction occurred. 0013 is now fully hosted-verified. 0014 is now applied and its exact catalog and safe hosted tests passed. 0015 is also fully hosted-verified. 0016 pricing/settings is now applied and fully hosted-verified. The next manual dependency is [recovery email and HTTPS configuration](E2E-EXTERNAL-SETUP.md). Actual email delivery and the complete enabled E2E remain pending.

## Phase 1: foundation

- Fresh npm / Next.js App Router / TypeScript project.
- Tailwind design tokens and accessible base styles.
- Supabase server client, session refresh, server-side user/role guards.
- Input validation and initial tests.
- Reproducible normalized schema, RLS, protected profile roles, restricted voucher credential columns, private storage, audit triggers.
- Explicit development seed vacancies.
- Unbranded generated hero asset.

Dependencies installed with zero reported npm audit vulnerabilities. TypeScript and the initial three validation tests pass. The foundation production build completed successfully with webpack. The project owner applied the foundation migration to hosted Supabase and configured credentials; Docker is not being used. Supabase public table connectivity is verified. Ownership/concurrency integration tests still belong to the later feature phases and are not implied by connectivity checks.

## Phase 2: public website

Reference-based responsive homepage and navigation, informational pages, database-driven job listing and details, search, filtering, sorting, pagination, and empty/error states are implemented. TypeScript, lint, tests and production build passed. Desktop visual inspection completed; mobile visual inspection remains outstanding. `DEMO_MODE=false`; at the Phase 2 checkpoint there were no public vacancies or active voucher types in the hosted database. Current managed intake and pricing are described below.

## Phase 3: authentication and dashboard foundation

Registration, login, recovery, password reset, callback exchange, logout, profile editing, protected applicant dashboard and database-role-protected admin overview are implemented. TypeScript, lint, eight unit tests and production build passed. Hosted integration verification passed on September 29, 2026: authenticated sessions, HttpOnly cookies, own-profile edits, cross-user RLS isolation, metadata/direct/API role-escalation defenses and administrative access. Temporary accounts were deleted after testing. Email delivery and recovery-link browser completion still require the configured email provider and redirect allowlist to be checked before release.

## Phase 4: one-time payments and regional pricing (in progress)

The project owner applied migration 0002. Hosted tests passed: eight concurrent fulfillment calls returned the same single voucher and notification; mismatched amounts rolled back; service-only RPC access and PIN-column restrictions held; concurrent rate limits admitted only the configured count. Temporary fixtures were removed. PINs use cryptographic randomness, salted scrypt hashes and AES-256-GCM encryption.

Implemented Paystack provider initialization/verification, raw-body webhook signature validation, shared verified callback/webhook fulfillment, manual payment retries, purchase price review, paginated payment/voucher histories, and owner-only printable receipts. Verification compares successful status, reference, charge amount/currency, customer email and test/live domain before invoking the existing atomic fulfillment function. No recurring charges or saved authorization codes.

The owner applied migration `202609290003_regional_voucher_pricing.sql`: worldwide country selection, configurable region/display-currency mapping, country/region GHS price overrides, effective/expiring FX metadata, immutable quotes and historical payment snapshots. Charge currency is GHS for the Ghana merchant; local currencies are estimates only. The single 90-day CruiseApply Application Access product is active at GHS 150.00 for Test Mode only. See [pricing architecture and verification](REGIONAL-PRICING.md).

The owner completed the original Paystack checkout and approved verification under its dedicated test applicant. Normal application verification fulfilled reference `CA-ccca503b-90ab-4b19-b287-ff5ed3c51176` with exactly one voucher and one notification. Repeated status/callback verification remained idempotent. Browser checks confirmed successful GHS 150.00 payment history, voucher history, the correct receipt and denial of anonymous/foreign receipt access. The reported reference `CA-a98a9774-d2b1-46e4-9c17-c7198ed9664b` belongs to a different applicant and is abandoned at Paystack; it remains pending without a voucher. Fixed misleading callback messaging to distinguish account/session problems from pending verification. See the [root cause and complete hosted results](PAYSTACK-E2E.md). No new transaction, manual success update, direct voucher insertion, ownership reassignment or Live Mode was used. Actual provider-delivered webhook testing remains outstanding. Voucher redemption and Phase 5 source are now implemented; see the workflow migration review below.

At the payment checkpoint, source passed TypeScript, lint, all 40 unit tests and the production build. Hosted migration-0003 tests passed for price precedence, charge/display separation, FX fallback, snapshot immutability, quote owner/expiry checks and six concurrent initializations producing one payment. Migration-0002 fulfillment tests passed against the new schema. Disposable integration fixtures were removed; the paid dedicated test applicant and its verified payment/voucher remain for review. The country catalog contains 249 distinct country codes.

## Phase 5: application workflow (approved intake E2E verified)

Implemented owned voucher redemption, retry recovery, application lists/details, a multi-step wizard, serialized autosave with revision conflicts, ordered education/experience, private validated uploads and authenticated downloads, configurable vacancy questions/documents, review/declaration and atomic submission. Submitted applications are read-only through applicant operations. No payment verification or fulfillment behavior changed; no additional transaction was initialized.

The owner applied migrations 0004 and 0005 and approved the genuine Hospitality & Guest Services managed intake. Hosted checks verified workflow columns, service-only permissions and the private bucket. Original-owner voucher `CRV-2026-00000003` created submitted application `APP-2026-00000001` through the internal wizard, optional private uploads and declaration flow. Concurrent redemption recovered one application; stale saves conflicted; repeated submission remained idempotent. See [current E2E results and limits](APPLICATION-E2E.md). No employer match was fabricated.

TypeScript, lint, 56 unit tests and the final production build passed, including the navigation-save refinements. Non-consuming redemption checks passed, including mobile layout after fixing responsive button visibility. The original voucher is now used by APP-2026-00000001; see APPLICATION-E2E.md.

Final production-browser verification passed: submitted applicant page/dashboard, repeated submission, foreign-applicant RLS and route denial, database-role admin review, exactly one submission notification/history/audit entry, and zero employer matches. Disposable review accounts were removed successfully. The original GHS 150 payment and one-voucher invariant remain intact. See [results and test limits](APPLICATION-E2E.md). Provider-delivered webhook testing remains pending; it does not block independent development.
## Phase 6: applicant tracking and in-app notifications

Implemented linked dashboard summaries, profile essentials, status guidance and filters, recorded-status timeline, private document downloads, paginated notifications, unread counts and owner-only mark-as-read controls. TypeScript, lint, 62 unit tests and production build passed. Hosted/browser checks passed for ownership/RLS/origin denial, retry timestamp stability, unread UI behavior, safe links, mobile layout and original-owner tracking/downloads. Disposable fixtures were removed. Original payment, voucher and application records were not changed. See [Phase 6 results](PHASE6-TRACKING-NOTIFICATIONS.md).

## Phase 7: staff screening review

The owner applied migration 0006. Protected staff decisions, a filtered/paginated queue and audited staff document downloads are implemented. TypeScript, lint, 71 unit tests and production build passed. Hosted RPC and production-browser checks passed for authorization, invalid/stale decisions, six identical concurrent retries, competing decisions, exact history/notification/audit counts, internal acceptance wording and original-owner visibility. Temporary fixtures were removed; the original submitted application was unchanged. See [staff review results](STAFF-REVIEW-E2E.md).

The owner applied migration 0007. Private staff notes are implemented and verified: authenticated RLS reads, session-derived actors, idempotent RPC writes, context revision checks and body-free audit events. TypeScript, lint, 80 unit tests, production build and hosted/production-browser checks passed, including an interrupted-save retry, applicant read isolation and unchanged original application. Temporary fixtures were removed. See [staff notes results](STAFF-NOTES-E2E.md). Remaining admin management and employer referral actions are not yet delivered. The public webhook handler passed controlled tests; actual provider-origin delivery remains independently pending.

## Remaining phases

4. Public HTTPS webhook signature/replay/forgery checks passed. Actual provider-origin delivery still needs a recorded event: Paystack reports none for the original successful transaction. See PAYSTACK-WEBHOOK-TEST.md. Payment verification, fulfillment and redemption are implemented and tested.
5. Approved managed-intake flow is verified; broader upload/submission race tests and operational orphan-file reconciliation remain hardening work.
6. Legacy in-app tracking and notifications are verified. Voucher-scoped adapters are implemented behind the disabled rollout; actual recovery email delivery remains required; SMS/WhatsApp are out of scope.
7. Protected admin workflows and job/application/payment management.
8. Reports, administrative audit attribution and settings.
9. Responsive, accessibility, security and integration testing; deployment documentation.

## Asset provenance

`public/cruise-hero.png` was generated using the built-in imagegen tool, guided by the supplied homepage reference.

Prompt: “Use case: photorealistic-natural. Asset type: CruiseApply website hero background, wide landscape 3:1. Create a photorealistic large unbranded modern white cruise ship at sea, viewed from the front starboard quarter, occupying the right half of the composition. Bow points right, entire ship visible. Pale blue sky and subtle warm sunrise clouds, calm blue water along bottom. Left half is almost white soft sky and mist, generous empty space for HTML text. Minimal professional travel photography matching a light white/navy/blue recruitment website. No text, no logos, no branding, no watermarks, no UI, no cards. Save the generated asset for use in the project.”

## Managed opportunities: applied and configured

The owner clarified the managed screening/matching model. Four researched Carnival roles were added only as unpublished drafts; none was published or used for paid applications. Migration 0004's hosted boundary checks passed. The owner applied migration 0005, which provides: optional employer at intake, explicit managed/research classification, service snapshots and separate employer/matching records. See MANAGED-OPPORTUNITIES.md for the review and exact SQL Editor steps. The owner approved the Hospitality & Guest Services managed intake. The original voucher has now created one submitted application, APP-2026-00000001; see APPLICATION-E2E.md. No employer application or external referral was sent.

## Public Test Mode webhook checkpoint

The owner configured the Cloudflare URL. Public handler checks passed for HMAC signature rejection, raw-body tampering, malformed signed events, successful existing-transaction replay and three concurrent duplicates. A signed false-success payload for the unpaid transaction failed normal provider verification without fulfillment. Before/after digests confirmed existing payment, voucher, notification and application records unchanged. No new Paystack transaction was created. Actual provider-origin delivery is still unverified: lookup returned 404 and the transaction-filtered event list returned zero events. A fresh Test Mode checkout or an event made available by Paystack is required. See [webhook evidence and manual steps](PAYSTACK-WEBHOOK-TEST.md).

## Applicant authentication correction: current direction

The owner requires serial/PIN applicant login and guest voucher purchase, with staff Supabase authentication kept separate. The existing public applicant email/password flow does not meet that requirement. The [approved architecture](VOUCHER-AUTH-ARCHITECTURE-REVIEW.md), applied/verified 0008-0009 and disabled server boundary are the foundation for the current work order above. Existing successful E2E records remain unchanged. Further Paystack checkout E2E is paused until the redesigned flow and reviewed cutover are ready.

## Voucher-auth expansion 0008: applied and hosted-verified

The owner approved voucher authentication, independent post-redemption tracking, hash-only PIN rotation and 7-day idle / 30-day absolute sessions. [Migration 0008](VOUCHER-AUTH-EXPANSION-MIGRATION.md) prepares private principal/session/checkout/recovery tables and compatibility ownership columns. Existing user_id NOT NULL constraints, RPCs, RLS and test records remain intact. No applicant auth cutover or Paystack transaction has occurred. New hash-only PIN delivery will require a protected initial claim and later verified rotation rather than stored-PIN retrieval.

Final pre-application review corrected 0008 before the owner applied it. Local PostgreSQL execution, private-table permissions, ownership/session constraints, legacy RPC compatibility and transactional rollback checks passed. Hosted catalog verification is complete; see the migration review and 0009 hosted evidence. Actual guest claim/reset operations are later stages and are not implied by schema verification.

## PIN recovery checkpoint (2026-10-04)

0011 is fully hosted-verified. Migration 0012 is applied and fully hosted-verified; the recovery UI/API remain behind the disabled rollout. Exact local SQL/catalog/rollback checks, TypeScript and all 146 unit tests passed; the production build completed. Disabled-route desktop/mobile browser checks passed after allowing longer test requests on the slow development host. The final full lint run passed. Hosted recovery subsequently passed; actual email delivery remains untested. No rollout, hosted migration, Paystack transaction or email was performed.

## Applicant response/withdrawal checkpoint (2026-10-04)

Migration 0012 is fully hosted-verified; the original records remain unchanged and all disposable fixtures were removed. Migration 0013 is prepared only: four scoped operations and an immutable staff-readable response/request table, applicant reply/attachment/withdrawal controls and staff reply review. The original submitted form remains immutable. No hosted 0013 call, migration application, applicant rollout or Paystack transaction has occurred. Exact local SQL/rollback/RLS/scope/idempotency checks and 156 unit tests passed. TypeScript, full lint and production build passed. Production HTTP/headless Edge checks at 390px and 1440px passed, including the new reply, attachment and withdrawal endpoints returning 404 without credentials or cookies while rollout is disabled. Enabled 0013 browser/concurrency tests await manual migration application. See APPLICANT-ACTIONS-MIGRATION.md for security details and the manual step.

## Employer matching checkpoint (2026-10-10)

0013 hosted catalog, concurrency, authorization, private-storage and preservation checks passed; all fixtures were removed. The next stage provides employer/opportunity administration, qualification-gated matching, applicant consent bound to the exact employer/recipient/documents and revisions, revocation, and staff recording of completed referrals. Referral recording does not transmit candidate data. Migration 0014 is prepared only, with its review document, exact catalog query/comparator and safe hosted research-state verification runner. Full positive hosted matching/referral E2E requires a legitimate authorized opportunity; no match is fabricated for testing.

Exact local SQL/rollback/security tests, 166 unit tests, TypeScript and production build passed. Final full lint and production HTTP/headless Edge checks at 390px and 1440px passed. The first browser startup timed out; an isolated retry passed. Local preservation checks include unchanged existing application revisions, and the expanded 0014 catalog query executed successfully. Applicant rollout remains off; no email, Paystack transaction or hosted 0014 mutation has occurred. The remaining administration/reporting, communications, full provider/applicant E2E and production-readiness workstreams remain open.

## 0014 hosted completion (2026-10-10)

[Exact catalog and safe hosted verification passed](EMPLOYER-MATCHING-0014-HOSTED.md), with complete fixture cleanup and unchanged original records. Earlier 0014 review-only notes describe the preparation checkpoint. Administration/reporting development continues; no rollout or provider transaction occurred.

## Administration checkpoint (2026-10-10)

0014 exact catalog and safe hosted verification passed, with complete fixture cleanup and unchanged original public-table snapshots. Initial administration records, operational reports, audit view and page-sized CSV exports are implemented. Managed-intake and super-admin GHS product editors use the separately reviewable [0015 service-only operation](ADMINISTRATION-CONTROLS-MIGRATION.md). 0015 is not applied. The local SQL/rollback/security suite and all 176 unit tests passed; TypeScript and production build passed. Final full lint and production HTTP/headless Edge checks at 390px and 1440px passed, including anonymous export denial and cross-origin configuration denial. Enabled staff configuration E2E and hosted concurrency remain pending 0015. No hosted 0015 write, original-record change, applicant rollout, email or Paystack transaction occurred.

## 0015 hosted verification and regional administration (2026-10-10)

0015 exact catalog and all 237 NOT NULL column checks passed. Hosted service/staff/super-admin authorization, six identical concurrent saves, one attributed audit, conflicting requests, stale revisions and role revocation passed. Initial cleanup encountered intermittent fetch failures; targeted fixture cleanup completed, then a fresh full run passed with saved before/after hashes and complete fixture removal. Original public-table snapshots matched. See ADMINISTRATION-0015-HOSTED.md.

The next grouped [0016 pricing/settings stage](PRICING-SETTINGS-MIGRATION.md) is review-only. Region/country/display FX/override controls and public support contacts are implemented; exports fail closed if their new audit operation is unavailable. No configured rates, mappings, prices or contacts have been changed. Local 0016 SQL tests passed; final build/unit/lint/browser results follow below.

0016 validation checkpoint: local SQL/rollback/preservation checks, TypeScript, all 182 unit tests and full lint passed. Production build and browser completion remain pending at this checkpoint. No actual FX, country mapping, support contact or approved price was changed.

## 0016 applied and hosted verified (2026-10-11)

[Full catalog and hosted authorization/concurrency/preservation checks passed](PRICING-SETTINGS-0016-HOSTED.md); all fixtures were removed. Production build, TypeScript, full lint, 182 unit tests and desktop/mobile disabled-boundary checks passed. Earlier preparation notes are historical. No further migration is currently required. The remaining external prerequisites are a verified recovery-email sender and a stable HTTPS test origin. Applicant rollout remains disabled and Paystack is Test Mode. Authenticated staff-browser verification passed, including pricing configuration reads, saves/retries, audited exports, 390px/1440px views and role-revocation denial. All fixtures were removed and original public-table hashes matched. No enabled applicant journey is claimed yet.

### Final staff-browser correction and external gate (2026-10-11)

Fixed configuration reads that incorrectly used a direct authenticated client against intentionally private pricing tables. Server-only pricing reads now require the authenticated database session to pass `is_admin()`; no grants or RLS policies were changed, and business-record reads retain their RLS client. The corrected source passed TypeScript, full lint, all 185 tests, production build and the complete authenticated staff-browser run. Fixtures were fully removed; original records remain unchanged.

Next owner action: complete [verified recovery sender and HTTPS setup](E2E-EXTERNAL-SETUP.md). Expected result: a verified Resend domain/sender, local sending credentials, reachable HTTPS application and saved Paystack Test webhook. Then continue the controlled enabled applicant/recovery/browser journey and prepare the single necessary provider-origin Test Mode checkout. No further migration is currently required. Rollout remains disabled; no Live Mode or new payment was enabled.

## Public applicant journey correction (2026-10-11)

Public navigation always uses Buy Voucher and Applicant Login (Serial Number + PIN), independently of rollout. `/register` redirects to voucher purchase; the application registration API returns 410 before accessing Supabase Auth. The registration form has been removed. Disabled purchase/login entry points explain availability without collecting credentials or redirecting applicants to staff login. Public activation/tracking aliases lead to applicant login. Staff email/password authentication remains at `/login`, explicitly labeled Staff Login. Existing accounts and data are unchanged; applicant rollout remains disabled. This closes the legacy registration UX gap; it does not claim the enabled applicant E2E is complete.

Validation for the public journey correction: TypeScript, full lint, 187 unit tests and production build passed. Disabled-rollout HTTP/Edge checks passed with no credentials or cookies issued. Public browser checks passed at 390px, 1024px and 1440px: registration redirects to purchase availability, applicant login collects no credentials while disabled, staff login is clearly labeled, navigation has no registration link, and direct application registration returns 410. The updated local production server was restarted on port 3000. No hosted data or rollout setting changed.

## Admin overview visual redesign (2026-10-11)

Reference-based navy staff sidebar, top search/profile bar, responsive overview cards, daily application chart (7/30/90 days), status donut with filter links, recent applications and quick actions are implemented. Counts use authenticated staff RLS reads; published managed opportunities and successful payments are explicitly filtered. Application dates are paginated for the selected UTC period; chart counts are available as an accessible table. No invented growth rates, notification badges, candidates or system-health claims are displayed. Search uses the existing application-reference filter. Super-admin configuration navigation remains role-specific; server authorization is unchanged. No migration or business-row mutation is required. Validation passed: TypeScript, full lint, 187 unit tests and production build. Authenticated browser checks passed at 1750px, 1024px and 390px, including metric/status reconciliation, no horizontal page overflow, mobile navigation, seven-day chart selection and accessible daily table, application search and quick-action navigation. Desktop/mobile screenshots were visually inspected. Evidence: `test-results/admin-overview-browser.json` and `admin-overview-*.png`. The local server is running on port 3000.

## Records and exports visual redesign (2026-10-11)

Applied the supplied records-page reference to the shared records UI: active category tabs, styled GET search/status filters with clear action, matching-record summary, bordered table card, text status badges, readable UTC dates and a CSV footer with pagination. Narrow screens scroll tabs/table inside their containers. Existing allowlisted queries, staff checks, pricing read authorization, raw smallest-unit amounts and audited export routes are unchanged. No sample records, payment changes or schema changes were introduced. The redesigned admin sidebar is retained for consistency.

Validation: TypeScript, full lint, all 187 tests and production build passed. Authenticated desktop/tablet/mobile renders at 1800px, 1024px and 390px were captured and visually inspected; active tabs, CSV link presence and page overflow checks passed. The remaining browser filter/pagination sequence is not verified: the first run stopped at the status-filter step, and a diagnostic retry timed out waiting for the staff-login HTTP response. No business records were changed. Evidence: test-results/records-design-*.png and records-design-*.log. Full browser interaction verification remains outstanding.

## Reports and candidate screening redesign (2026-10-11)

Applied the supplied references with responsive icon metric cards grouped by applications, payments and vouchers, and a candidate list with aligned filters, right-aligned review actions and UTC update timestamps. Reports retain every existing status, including draft, information-required and failure states; totals sum the existing status counts. Unused is not mislabeled as active. The report action opens the existing records/CSV workflow. Staff authorization, database queries and screening operations remain unchanged. TypeScript, targeted ESLint and production build passed. Authenticated browser visual verification of these two pages remains outstanding.


## Marketing homepage redesign (2026-10-11)

Applied the supplied landing-page structure: ship hero, overlapping benefit strip, Serial/PIN journey, live featured managed opportunities, eight career-area links, accessible native FAQ disclosures and voucher CTA. Existing image reused; no invented opportunity records, employer associations, prices or validity values. Checkout remains the authoritative pricing source. Existing applicant rollout and staff authentication remain unchanged. Validation pending.

Marketing validation: TypeScript, targeted ESLint and production build passed. Public browser checks passed at 1440px and 390px, including FAQ disclosure and no horizontal page overflow. Screenshots were visually inspected. The local production server was restarted with the new design. Evidence: test-results/marketing-1440.png, marketing-390.png and marketing-build.log.

## Tinos and temporary applicant UI preview (2026-10-12)

Tinos regular, bold and italic are served locally using @fontsource/tinos. Global typography uses Tinos with serif fallbacks. TypeScript, targeted lint and the font production build passed.

The isolated applicant preview uses https://localhost:3443, Secure/HttpOnly/SameSite cookies, the normal one-time credential claim, scrypt PIN verification and existing service-only session RPCs. Start it with `powershell -File scripts/start-applicant-ui-preview.ps1`; in another terminal use `node --env-file=.env.local scripts/open-applicant-ui-preview.mts` to open the claim browser. Its separate build directory avoids interfering with the existing server. The enabled flag is process-only; .env.local and general rollout are unchanged. Certificates and preview build files are ignored.

A user-authorized synthetic UI fixture is retained in hosted Supabase, labelled UI PREVIEW ONLY with provider ui_preview_fixture and a UI-TEST serial. The required payment parent is a synthetic one-pesewa record, not a provider payment or revenue; it will appear in raw counts until removed. The ledger is test-results/applicant-ui-preview.json; its checkout capability is encrypted, and no PIN is stored in that file or logged. The PIN is generated and shown once only after the user claims it. The voucher allows redemption for seven days; normal session/lifecycle rules remain in force. Contact is example.invalid, so email recovery is unavailable for this fixture. Existing business records are unchanged. No Paystack call or real fulfillment was performed. Remove only this ledger's fixture chain after UI work; do not delete original successful test records.

The npm install audit reports seven high-severity dependency findings; dependency remediation is separate from this font/UI change and has not been claimed complete.

## Applicant experience refresh (2026-10-12)

Added a shared responsive applicant sidebar/workspace covering overview, application, documents, notifications and receipt, with active navigation, support access, mobile menu and existing verified logout. Login now has a branded split layout and the purchase page uses a consistent card workspace. Replaced the repeated dashboard disclaimer with positive service guidance; accurate service/payment terms and employer decision boundaries remain intact. No new guarantees, employer affiliations or sample applications were added.

Local development on localhost:3000 forwards gated applicant login/purchase entry points to the isolated HTTPS preview on localhost:3443. This is development-only; production rollout and origin/session checks remain unchanged. Email recovery still requires external provider configuration; visual availability is not a claim of complete provider readiness. No Paystack transaction or hosted data change was performed for this refresh.

TypeScript and 35 auth/portal regression tests passed. Secure login browser checks passed at 1440px and 390px; the mobile screenshot was visually inspected. Authenticated portal visual checks remain outstanding. Production build and final lint completion are being checked.

Applicant refresh final validation: targeted ESLint and production build passed. The isolated HTTPS development preview serves the updated UI; production rollout remains disabled.

## Completion work without a domain (2026-10-12)

Domain purchase is deferred to deployment. Restricted Resend delivery can be tested with onboarding@resend.dev and the Resend account mailbox; arbitrary-recipient email requires the later verified domain. Updated E2E-EXTERNAL-SETUP.md accordingly. Current configuration check confirms general applicant rollout is disabled, Paystack uses a test key and recovery email is not configured. No secrets are included in readiness output.

Excluded .next-applicant-preview generated artifacts from ESLint. Applicant mobile navigation now marks the hidden sidebar inert, exposes its controlled region and supports Escape with focus restored to the toggle. Preparing automated real-session browser checks using a separate disposable fixture; the owner's UI voucher is not reused or rotated.

The dependency audit identified Next.js fixes in 16.3.8, source-map-js below 1.2.2 and an unpatched braces dependency in the lint toolchain. Do not use npm audit fix --force: its proposed eslint-config-next downgrade is incompatible with this application's framework version. Interrupted registry transfers were recovered via official-registry downloads and the npm cache. Final patched-package verification follows below; no clean security result is claimed at this checkpoint.

Patched dependency validation: Next.js and eslint-config-next 16.3.8, matching Windows SWC 16.3.8 and source-map-js 1.2.2 are installed. All 187 tests in 31 files, TypeScript and the production build passed. The remaining braces advisory in the development lint toolchain is unresolved; no clean post-update audit is claimed.

Authenticated browser verification remains incomplete: the staff Records runner receives HTTP 400 from staff login, and disposable applicant claim checks encountered transient hosted failures. The disposable browser fixture has been removed; the owner's separate UI preview fixture remains intact. No production rollout or Paystack transaction was performed. Added a retry control for a failed checkout-status read; it does not initialize another transaction or repeat credential claim.

Receipt refresh (2026-10-12): distinct actions/matches React key prefixes remove the sibling collision. Dedicated applicant receipt layout includes print-only shell removal, long-reference wrapping and explicit synthetic-fixture labeling. Temporary GHS 1 base-price SQL prepared at supabase/configuration/temporary-ghs1-pricing.sql, not applied. Local key was checked without disclosure and remains Test Mode; guest checkout's test-only guard is unchanged. No payment initialized. Browser print review remains pending.

Live-mode preparation (2026-10-17): central payment-mode checks now require an explicit live setting, matching key, enable flag and HTTPS non-loopback origin. Guest checkout uses the same guard. No activation, payment, migration or local secret change performed. Resend recovery success is user-confirmed; arbitrary-recipient domain delivery and final provider-origin/live journey remain release checks. See LIVE-DEPLOYMENT.md. Automated validation results are recorded separately after completion.

Repeat voucher purchase correction (2026-10-18): the browser checkout guard previously rejected every existing payment, including successfully claimed vouchers. A completed purchase with claim_available=false now permits a fresh, separately owned checkout. Paid/unclaimed and pending/initialized/unknown states remain protected; lookup failures do not authorize replacement. The guard does not match or merge applicants by email. No database migration or provider transaction is required. Deployment of this code is required before hosted behavior changes.

Validation for the repeat-purchase correction: 10 checkout tests, TypeScript rerun and targeted ESLint passed. The first standalone typecheck encountered stale generated FX types from the reverted route; regeneration and the rerun resolved that. Production compilation, build TypeScript and all 43 static pages passed; trace completion remains pending at this checkpoint. No hosted purchase was initialized.

Explicit separate checkout (2026-10-18): unresolved initialized/pending payments now have an acknowledgment flow. The purchase form reads the cookie-scoped earlier reference, displays its amount and recovery guidance, then offers Start a separate purchase only after confirmation. The server matches startNewForReference to the actual cookie-scoped payment and allows only pending/initialized overrides. Successful unclaimed payments and unknown states remain protected. Earlier payment, voucher, webhook fulfillment and quote snapshots are untouched; the new quote has a fresh capability/principal. No provider initialization is performed by creating the quote. This changes the browser's active checkout, not the underlying earlier payment. No migration required.
Validation: all 13 guest-checkout service tests, standalone TypeScript, targeted ESLint and production build passed for the explicit separate-purchase flow. Hosted purchase behavior awaits deployment; no new provider transaction was created for these tests.

Checkout launch correction (2026-10-18): confirmed hosted base price remains 100 pesewas with no overrides. Prepared restore-ghs150-pricing.sql for manual restoration of the approved 15000/GHS price; no hosted configuration change was applied automatically. Previously issued quotes/payment links retain their snapshots.

The purchase form now checks for an actual cookie-scoped payment before rendering earlier-checkout options. Fresh visitors and quote-only visitors see the ordinary form. Paid/unclaimed buyers are directed to claim; claimed buyers can buy again. Pending buyers can resume the exact existing saved Paystack URL through a same-origin, capability-scoped POST /api/guest-checkout/resume without creating a payment, or explicitly acknowledge a separate purchase. A synchronous submission guard prevents concurrent clicks. All payment verification and ownership constraints remain in place.

Validation: 18 service tests passed, six intercepted browser scenarios passed (fresh mobile, quote-only, claimed, unclaimed, pending separate purchase and pending resume), TypeScript and targeted lint passed, and production build passed. A real anonymous public price-quote request returned 200; its unique disposable principal/checkout/quote were removed, with no payment initialization or Paystack call. An initial full-suite run passed 203 tests with one cryptographic timeout under load; a serial full-suite retry is being completed. Browser mock prices test presentation and are not evidence of restored hosted pricing.
Final regression retry: all 204 tests in 32 files passed with one worker and a 30-second test timeout; no cryptographic implementation or security constraint was changed. All six browser scenarios and the production build passed.
