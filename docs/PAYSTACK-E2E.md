# Paystack Test Mode checkout — verified

## Root cause of the reported pending payment

Two distinct references belonged to different applicants:

| Check | Reported dashboard payment | Successful original checkout |
| --- | --- | --- |
| Reference | CA-a98a9774-d2b1-46e4-9c17-c7198ed9664b | CA-ccca503b-90ab-4b19-b287-ff5ed3c51176 |
| Paystack transaction ID | 6607374087 | 6607367943 |
| Paystack status | abandoned | success |
| Paystack domain | test | test |
| Amount / currency | 15000 / GHS | 15000 / GHS |
| Email vs its own stored payment | matches | matches |
| Final CruiseApply status | pending (unchanged) | successful |
| Vouchers | 0 | 1 |

The successful hosted checkout was the original link provided for the dedicated test applicant. The dashboard reference belonged to a different applicant and was not paid. The `abandoned` provider status for the reported reference correctly fails `assertVerifiedPayment()` before credential generation or `fulfill_verified_payment()` is invoked. No amount, email, currency, domain, transaction-ID parsing or encryption error was found.

The callback uses Paystack's `reference` query parameter and scopes the lookup to the authenticated applicant. A callback for the paid test applicant's reference cannot fulfill while signed in as another applicant. Previously, all callback failures were collapsed into `verification=pending`, misleadingly implying that an inaccessible payment was merely awaiting confirmation. The dashboard then listed the signed-in applicant's own payments, including the unrelated unpaid reference.

Historical callback session logs were not retained, so the original request's exact 401 versus owner-scoped 404 cannot be proven retrospectively. The account mismatch was confirmed in the database, and the foreign-account callback behavior was reproduced. Reference propagation was also exercised with matching `reference` and `trxref` parameters; the correct original reference reached the verification function.

## Exact fix and recovery

- `src/app/api/payments/callback/route.ts` now maps authentication/ownership failures (401, 403, 404) to `verification=account`, while provider/database failures remain retryable as pending.
- `src/app/dashboard/payments/page.tsx` now explains that the current session cannot access that checkout, directs the applicant to the purchasing account, and clarifies that listed payments belong to the current account.
- Added regression tests for abandoned payments, owner-scoped lookup rejection, callback reference propagation, account/session errors, and retryable verification failures.
- After the owner explicitly approved verification of the successful original checkout, the runner authenticated as its original dedicated test applicant and invoked the normal application verification endpoint. The app verified the successful provider transaction and then called the existing `fulfill_verified_payment()` function successfully.

No new Paystack transaction or payment record was initialized. No payment status was manually set, no voucher was manually inserted, no ownership was transferred, no schema was changed and no verification invariant was weakened. No exception from the fulfillment RPC occurred during normal verification of the paid reference.

## Final hosted and browser results

For `CA-ccca503b-90ab-4b19-b287-ff5ed3c51176`:

1. Payment changed from `pending` to `successful` through normal verification/fulfillment.
2. Exactly one voucher exists: `CRV-2026-00000003`, ID `84cf5689-4b9d-4523-9300-8cbe95d0f8c7`, status `unused`.
3. Exactly one `Voucher ready` notification exists for the dedicated test applicant.
4. Repeating status verification and the authenticated callback returned the same voucher with no duplicate notification or voucher.
5. The voucher appeared in the applicant's voucher history.
6. Payment history displayed GHS 150.00 and successful status.
7. The receipt displayed the correct payment reference, GHS 150.00 charge and an eight-digit PIN. Its PIN was masked in the saved screenshot. Anonymous receipt requests redirected; another authenticated applicant received not-found without transaction details.
8. Purchase time is `2026-09-29T14:27:20.508996+00:00`; expiry is `2026-12-28T14:27:20.508996+00:00` (90 days).

The unrelated unpaid reference `CA-a98a9774-d2b1-46e4-9c17-c7198ed9664b` remains pending with zero vouchers. The paid voucher remains owned by the dedicated test applicant and will not appear in the other applicant's account.

The temporary second applicant used to test receipt isolation was removed. The original paid test applicant and its records remain available for review. Its generated credentials are in the locally ignored `test-results/checkout-e2e-state.json`; do not share or commit that file.

## Evidence and checks

- `test-results/checkout-price.png`: product, 90-day validity and GHS 150.00 price review.
- `test-results/payment-history.png`: successful original payment.
- `test-results/voucher-history.png`: single voucher in the original applicant's dashboard.
- `test-results/voucher-receipt.png`: owner receipt with PIN masked.
- `scripts/checkout-e2e.mts verify`: normal endpoint, replay, callback and receipt-isolation checks; refuses non-test keys and restricts this investigation to the approved original reference.
- `scripts/diagnose-payment.mts`: read-only comparison of both references using the real provider parser and verification comparisons; never initializes or fulfills a payment.

TypeScript, lint, all 40 unit tests and the final production build passed.

Actual Paystack-delivered webhooks have not been tested because the app origin is localhost. No Live Mode was enabled. Public HTTPS webhook setup is a separate next step, after this investigation report is reviewed.

## Public webhook follow-up (October 2, 2026)

The public tunnel handler passed controlled signature, replay, concurrency and forgery checks with original records unchanged. These were locally signed test requests, not confirmed Paystack-origin deliveries. The original transaction has no recorded webhook event available to resend. See [current webhook results and remaining provider-delivery step](PAYSTACK-WEBHOOK-TEST.md).
