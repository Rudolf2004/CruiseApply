# External setup for the controlled applicant E2E

## Development without a purchased domain (approved 2026-10-12)

A domain purchase is deferred until deployment. For restricted email delivery testing, create a Resend API key and configure EMAIL_PROVIDER=resend and EMAIL_FROM=CruiseApply <onboarding@resend.dev>. Store the API key only in local secrets. Resend restricts this sender to the email address associated with the Resend account. Use a separate disposable recovery fixture tied to that verified mailbox; do not reassign the existing UI fixture contact or send to arbitrary applicants. A successful provider response alone does not prove inbox receipt.

The isolated https://localhost:3443 preview supplies HTTPS for local browser/session testing. Keep general rollout disabled and Paystack in Test Mode. A public HTTPS tunnel and a saved Paystack Test webhook are still required for provider-origin webhook delivery; localhost alone is insufficient. Existing temporary UI voucher access is independent of email setup.

No domain is required for the remaining coding, local browser checks, API authorization tests or documentation. The domain/sender instructions below apply to deployment and unrestricted applicant email, not as a prerequisite for all development.

## Deployment sender setup

No further migration is currently required. Keep Paystack in Test Mode and `APPLICANT_AUTH_ENABLED=false` during this setup. Do not make another payment yet.

1. In [Resend Domains](https://resend.com/domains), add a domain you control and install the DNS records Resend supplies at your domain's DNS provider. Wait until Resend marks the domain verified. Use an address on that domain as the sender. See the [official domain instructions](https://resend.com/docs/dashboard/domains/introduction).
2. In [Resend API Keys](https://resend.com/api-keys), create a key with Sending access restricted to the verified domain. Save it locally; do not paste it into chat. See [API key documentation](https://resend.com/docs/dashboard/api-keys/introduction).
3. Set these values in the project's `.env.local` (or the isolated test deployment's secret settings):

   ```dotenv
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=<your sending key>
   EMAIL_FROM=CruiseApply <your-address@your-verified-domain>
   NEXT_PUBLIC_APP_URL=https://<your-current-public-test-origin>
   ```

   Leave `PAYSTACK_SECRET_KEY` as the existing `sk_test_...` key and `APPLICANT_AUTH_ENABLED=false`. Use a current HTTPS deployment or tunnel that forwards to CruiseApply on localhost:3000; a previous temporary tunnel address may have expired.
4. Save `https://<your-current-public-test-origin>/api/payments/webhook` as the Paystack **Test** webhook URL. Restart the application after updating its environment; rebuild if testing the production build because `NEXT_PUBLIC_APP_URL` is a build-time public value.
5. Confirm the public HTTPS homepage loads, Resend shows the domain verified and the Paystack Test webhook URL is saved. Report the public origin and sender address only, never keys or recovery codes.

Next: check configuration without exposing secrets, prepare the controlled enabled applicant browser run, verify real recovery-mail delivery and session rotation, then give the exact single Test Mode checkout instruction when provider-origin payment/webhook testing is ready. Enabling the controlled rollout belongs to that coordinated test, not this setup. Existing successful records remain intact.

This is a test dependency, not production approval. Full enabled applicant E2E, genuine provider-origin webhook delivery, production monitoring and backup restoration remain unverified until actually exercised.
