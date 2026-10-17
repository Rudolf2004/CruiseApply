# Paystack public Test Mode webhook verification

> Checkout follow-up is paused pending the voucher-based applicant authentication review. Do not perform a new account-based checkout under the steps below. See [the architecture proposal](VOUCHER-AUTH-ARCHITECTURE-REVIEW.md).

Verified through `https://mumbai-upon-net-thumbnail.trycloudflare.com/api/payments/webhook` on October 2, 2026, forwarding to the running CruiseApply server at localhost:3000 (process inspection identified next start). The configured key was checked to be a test key. Live Mode was not enabled.

## Passed through the public tunnel

- Missing, malformed and wrong-secret signatures: HTTP 401.
- Raw-body modification after signing: HTTP 401.
- Correctly signed malformed JSON or missing transaction reference: HTTP 400.
- Unhandled signed event: HTTP 200 acknowledgment.
- Signed replay for the existing successful reference: HTTP 200 after normal server-side Paystack verification.
- Three concurrent signed duplicates: HTTP 200 for every request, without duplicate fulfillment.
- Correctly signed success-shaped payload for the existing unpaid transaction: HTTP 500/retryable failure because Paystack verification did not confirm a successful payment. No voucher was issued. Event contents never substitute for transaction verification.

These were controlled requests signed locally with the configured test secret; they do not prove delivery originated at Paystack. No signatures, secrets or credential fields were printed or saved in the result artifact.

Before/after digests verified unchanged payment, voucher, notification and application records for the two existing references. The successful payment remains GHS 150.00, with exactly one voucher and one `Voucher ready` notification. Voucher `CRV-2026-00000003` remains used by `APP-2026-00000001`. The other payment remains pending without a voucher. No new Paystack payment was initialized.

Reproducible runner: `scripts/verify-public-webhook.mts`, with the approved public URL supplied through `TEST_WEBHOOK_BASE_URL`. Its reduced result artifact is `test-results/paystack-public-webhook.json` (ignored local test output).

## Actual provider delivery: remaining external step

Paystack verification confirms transaction `6607367943`, reference `CA-ccca503b-90ab-4b19-b287-ff5ed3c51176`, is successful in Test Mode for 15000/GHS. However:

- Event lookup by transaction ID returned HTTP 404, `Webhook not found`.
- The event list filtered to transactions / charge.success / that transaction ID returned HTTP 200 and zero events, with no next page.

There is no recorded event to resend for this transaction. The [official Webhook Events API](https://paystack.com/docs/api/webhook-events/) resends recorded event IDs; it cannot manufacture the missing original event. The reason that event was not recorded was not independently established.

A fresh completed Test Mode checkout is needed to generate a new provider event unless Paystack support makes an existing event available. No new checkout was created during these checks.

To perform that remaining test:

1. Keep localhost:3000 and the Cloudflare tunnel running. Keep Paystack in Test Mode with the configured Test Webhook URL. If the temporary tunnel URL changes, update only the Test Webhook URL.
2. Sign in as the dedicated test applicant at `http://localhost:3000/login`, then open `http://localhost:3000/buy-voucher` and use the standard CruiseApply voucher purchase flow to complete one new GHS 150 test checkout using Paystack's test payment controls. This will create a separate legitimate test payment/voucher, leaving the original records untouched.
3. Inspect that transaction's `charge.success` event in Paystack's webhook history, confirm the target URL and HTTP 200 delivery, and share its CruiseApply reference (never keys, PINs or authorization codes).
4. Verify exactly one voucher and notification for that new payment, then resend only its recorded event to confirm provider-origin duplicate delivery is idempotent.

The current controlled replay checks verify handler behavior and record preservation, but cannot establish that a new purchase was fulfilled specifically by an actual Paystack delivery rather than its callback.
