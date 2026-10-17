> Current status (2026-10-03): migrations 0008 and 0009 are applied and fully hosted-verified. See [0008 evidence and legacy ACL differences](VOUCHER-AUTH-0008-HOSTED.md) and [0009 complete verdict](VOUCHER-SESSION-0009-HOSTED.md). The [server authentication boundary](APPLICANT-AUTH-SERVER-BOUNDARY.md) remains disabled. Earlier pre-application notes below are historical.

# Migration 0008: voucher authentication expansion (review only)

SQL: [202610020008_voucher_auth_expansion.sql](../supabase/migrations/202610020008_voucher_auth_expansion.sql).

The voucher-auth direction and 7-day idle / 30-day absolute session limits are approved. This migration prepares storage and constraints only. It has NOT been applied. It does not enable guest checkout, applicant login or PIN recovery, change existing RLS policies, or replace existing RPCs. Do not resume payment E2E under the old registration flow.

## What this first migration adds

| Object | Purpose |
| --- | --- |
| applicant_principals | Independent applicant identity with no auth.users account and no staff role |
| guest_checkouts | Hashed purchase capability and contact/country snapshot; one checkout principal |
| voucher_access | One voucher per access/principal, independent revocation/suspension and credential version; hash-only new/rotated PIN credentials |
| applicant_sessions | Hashed random session token, voucher scope, credential version, 7-day idle and fixed 30-day absolute lifetime |
| voucher_contacts | Voucher-specific email and verification/version state; email is deliberately not unique across vouchers |
| voucher_contact_challenges | Expiring, single-use verification/reset capability digests bound to one voucher/contact/version |
| voucher_credential_deliveries | Protected initial claim state; no plaintext or encrypted PIN field |
| applicant_notification_links | One voucher scope per notification, with an application or payment source |

New tables have RLS enabled and no policies/grants allowing anonymous or authenticated browser roles to access them. Explicit service-role CRUD grants support future protected RPCs. Trigger functions cannot be called directly by public/anon/authenticated/service_role. These triggers run through table operations; they do not provide login/reset endpoints.

Existing tables receive nullable applicant_id FKs and exactly-one-owner checks: payment_quotes, payments, vouchers, applicants, applications, application_documents and notifications. Quotes/payments also receive nullable checkout bindings. History/audits receive nullable actor_applicant_id; an event cannot simultaneously assert a profile actor and a new applicant actor.

**Staging refinement:** existing user_id NOT NULL constraints remain in place in 0008. Combined with the exactly-one-owner checks, this prevents the legacy business tables from accepting new independent-owner rows before their SQL operations and application code are ready. Dropping those NOT NULL constraints belongs to a later reviewed activation migration. This is safer than enabling half-supported guest ownership now.

New ownership guards prevent reassignment. The existing immutable payment/quote triggers already protect the newly added ownership fields. The managed-application trigger is not replaced; an additional guard freezes its future applicant_id. Binding triggers protect voucher/payment lineage (including requiring a successful/refunded purchase with paid_at), credential delivery scope and notification scope. They do not replace server-side Paystack verification. Contact changes require a new version and clear previous verification; old challenges remain tied to their original contact version. Actual challenge proof checking belongs to the later RPC.

## Preservation of existing records

- No INSERT, UPDATE or DELETE runs against existing business records. No legacy access/contact/notification backfill runs.
- All eight new tables start empty. No legacy credential is migrated or rotated.
- Existing owner IDs, voucher serials, PIN hashes/ciphertexts, payment snapshots, status/revision values, notification contents, document paths and staff actors are preserved. Added columns are NULL, so SELECT * shapes gain fields but existing business values do not change.
- Existing user_id FKs and NOT NULL constraints remain. Existing staff/account auth, owner RLS, staff notes RLS, private storage and current RPC grants remain unchanged.
- Unique payment-to-voucher and voucher-to-application constraints remain unchanged.
- Applied migrations 0001-0007 are not edited or rerun. The migration neither calls Paystack nor modifies provider configuration.

In particular, CA-ccca503b-90ab-4b19-b287-ff5ed3c51176, CRV-2026-00000003 and APP-2026-00000001 are not updated, reissued, remapped or resubmitted. An eventual legacy access binding is a separately reviewed insert into the new mapping tables, not ownership reassignment on those records.

## Voucher state and authentication design

Credential/session validity is separate from redemption eligibility. Authentication will require a verified current credential (or the explicitly permitted legacy hash), active principal/access, and a valid unrevoked session/version. It will not require voucher.status = unused.

| Voucher state | Applicant portal after valid credentials | New redemption/application |
| --- | --- | --- |
| unused, within 90 days | Own voucher/receipt and start-application flow | Allowed only after all existing opportunity/ownership checks |
| unused, past expires_at | Own limited portal, expiry explanation and receipt; existing linked application, if any, remains trackable | Denied |
| used | Resume the existing application and tracking even after expires_at | Never create a second application |
| expired | Own limited portal; track an already validly redeemed application if one exists | Denied |
| cancelled | Own receipt and existing tracking may remain readable unless access is explicitly suspended/revoked | Denied |
| refunded | Own receipt and existing tracking may remain readable unless access is explicitly suspended/revoked | Denied |

Cancellation/refund cannot grant new redemption or paid entitlement. They are service/billing states, not automatic credential revocation. Proposed conservative service policy: pause draft editing/submission for cancelled/refunded access while retaining existing tracking; do not silently withdraw, delete or change the application status. This service-policy detail requires review with the later operation migration; 0008 does not implement it or assume cancellation/refund mechanisms already exist. Explicit security suspension/revocation denies authentication independently of every voucher state.

A used voucher must never be rejected merely because its redemption expiry passed. An expired unused voucher must never be allowed to create an application merely because portal authentication succeeded.

## Approved session limits

- Server generates a random 32-byte session token; only its SHA-256 digest is stored.
- Cookie is Secure, HttpOnly, SameSite, with a separate applicant cookie namespace; staff sessions are separate. The eventual cookie lifetime cannot outlast the server's absolute expiry.
- Idle expiry is min(last valid activity + 168 hours, absolute expiry).
- Absolute expiry is creation + 720 hours and is immutable for that session.
- Activity timestamps cannot move backward or refresh an already idle-expired, absolutely expired or revoked session.
- Fresh successful login creates a new session; refreshing an existing session cannot reset its creation/absolute expiry. Logout revokes the current session only.
- PIN rotation must atomically bump the voucher credential version and revoke every session for that voucher access/principal. All protected operations must compare current credential version as well as expiry/revocation.

0008 provides storage, expiry arithmetic and update guards. It does not yet validate cookies, generate tokens, resolve sessions or implement logout; those are the next reviewed RPC/application phase.

## PIN reset and initial delivery: hash-only

New/current credentials live in voucher_access.pin_hash. There is no PIN ciphertext column in the new tables. Legacy credentials stay in the existing vouchers row until explicit later adoption/reset; current production receipt behavior is not silently changed by a schema-only migration.

Credential states:

- legacy: version 0 and no new hash; later login may verify the existing voucher hash after explicit legacy binding.
- pending_delivery: new purchase with no active PIN yet; no authentication is possible.
- current: a versioned secure hash exists; login must never fall back to an old legacy voucher hash after rotation.

**Necessary issuance adjustment:** the later webhook fulfillment will durably issue the voucher serial and pending access/delivery binding. The protected initial claim operation will generate the PIN and persist only its secure hash, then return the new PIN once over HTTPS for intentional display to the purchaser. It cannot retrieve an earlier generated PIN from storage. This requires a later reviewed change to the legacy mandatory pin_hash/pin_encrypted columns and fulfillment branching; 0008 deliberately leaves them unchanged.

If initial delivery or reset commits but the response is lost, do not replay/display that same PIN. Guide the applicant to verified reset/rotation. No PIN may be cached in idempotency results. Payment/voucher fulfillment remains idempotent; credentials are a separate one-time delivery operation, not a reason to issue another voucher.

Later PIN-reset transaction:

1. Request recovery for one serial; return generic responses and rate-limit by voucher and trusted client signals.
2. Send a short-lived, one-time verification challenge to the contact already associated with that voucher. Merely knowing its email, serial or payment reference is insufficient. Verification for one voucher never verifies another voucher sharing that email.
3. Verify the challenge digest, purpose, voucher, contact version, expiry and unused/unrevoked state under locks. Reset requests do not revoke sessions before successful proof.
4. Generate a new PIN server-side, derive its salted hash, atomically consume the challenge, replace the authoritative hash, increase credential_version, and revoke all sessions for that voucher. Record only safe actor/event identifiers in audit metadata.
5. Return the newly generated PIN once on the protected response. Never return the old PIN. Replays report completion without a PIN; lost delivery requires another verified rotation.

Hash format reserves s1 (existing scrypt encoding) and s2 for a future explicitly implemented credential format. This schema does not change existing eight-digit PINs or claim that an s2 verifier exists. PIN length/entropy for new issuance will be specified in the implementation review alongside throttling.

Legacy reset must invalidate the old credential, not merely add a new hash beside a still-accepted old PIN. The later migration must permit clearing obsolete legacy encrypted PIN data during an explicitly authorized reset and prevent old receipt/redeem/auth routes from retrieving/accepting it. No such clearing happens in 0008.

Email verification delivery still needs a configured transactional email mechanism and browser-flow verification. This migration sends no email and does not enable recovery without that external service. PINs are never included in notifications, email bodies, URLs, logs, audit metadata or persistent browser storage; verification challenges are separate from PINs.

## Manual Supabase step

1. Review the SQL and this staged behavior. No applicant flow should be switched on yet.
2. In the existing Supabase project's SQL Editor, select the postgres role and paste the entire final 202610020008_voucher_auth_expansion.sql, including BEGIN and COMMIT, into a new query. Run it once in a low-activity window because ALTER TABLE and constraint validation take locks. Do not execute selected fragments.
3. Confirm success and run the read-only checks below. If execution errors, stop; issue ROLLBACK if the editor connection remains in an aborted transaction and report the error before retrying. Do not rerun migrations 0001-0007 or edit existing test records.
4. The next work is hosted schema/legacy compatibility verification, then a separately reviewed migration for session/checkout/reset RPCs and independent-owner activation. RLS/auth cutover remains a later separate step.

Read-only post-application checks:

```sql
-- New private tables should exist with RLS enabled and no browser grants.
select c.relname, c.relrowsecurity,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
 ('applicant_principals','guest_checkouts','voucher_access','applicant_sessions',
  'voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links')
order by c.relname;

-- Legacy owner requirements remain; new owner columns are nullable.
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('payment_quotes','payments','vouchers','applicants',
                    'applications','application_documents','notifications')
  and column_name in ('user_id','applicant_id')
order by table_name, column_name;

select reference, status, amount, currency from public.payments
where reference = 'CA-ccca503b-90ab-4b19-b287-ff5ed3c51176';
select serial, status from public.vouchers where serial = 'CRV-2026-00000003';
select reference, status, revision from public.applications where reference = 'APP-2026-00000001';
```

## Final pre-application review: PASS after corrections

The unapplied 0008 was corrected in place:

- Fixed invalid dollar-quote delimiters in the contact and challenge trigger functions.
- Made checkout capability/ownership/contact snapshots immutable and revocation irreversible.
- Added unique checkout-to-credential-delivery binding and immutable delivery IDs.
- Added indexes for new foreign-key lookups.

The exact SQL executed successfully in local PostgreSQL 18.3 (PGlite 0.5.8), after executing the unchanged 0001?0007 files with locally mocked Supabase auth/storage schemas and pgcrypto. No hosted connection or environment credentials were used. Local synthetic fixtures exist only inside the disposable embedded database.

Verified locally:

- All eight private tables start empty, have RLS enabled, and deny every table privilege to anon/authenticated/PUBLIC; service_role has CRUD only. All eight new trigger functions deny direct execution to browser/service roles.
- Legacy business values, existing policies, table grants and existing function definitions/grants are preserved. Old user_id columns remain NOT NULL; new owner columns remain nullable.
- Duplicate voucher/access and delivery bindings, reassignment, invalid hash format, backward credential changes, and invalid ownership are rejected. All new foreign keys use non-cascading NO ACTION deletion.
- Session idle/absolute arithmetic, immutable absolute expiry, expired/revoked refresh denial, challenge consumption and binding immutability pass.
- Existing fulfillment replay, notification mark-read, staff review and private-note RPCs execute successfully against local fixtures.
- Injecting a failure immediately before COMMIT rolls back the entire expansion and preserves legacy data/policies. An accidental rerun fails atomically without deleting existing data.

Reproducible local harness: [verify-voucher-auth-expansion-local.mts](../scripts/verify-voucher-auth-expansion-local.mts). It requires the temporary PGlite package under test-results/sql-review; it never reads .env.local. Results are recorded in test-results/voucher-auth-0008-local-review.json. TypeScript/lint/build were not rerun: no application code changed, and these checks do not validate PostgreSQL SQL.

Limits: this is PostgreSQL runtime validation with Supabase schemas mocked, not hosted Supabase validation or a guarantee about its exact engine version. No hosted migration was applied. Cryptographic randomness and hashing cannot be proved by SQL format constraints: later server code must generate secure random tokens and persist only their digests. PIN derivation, token proof, cookie security and session authorization require the later protected operations.

## Concurrent initial claim foundation

UNIQUE voucher_access.voucher_id and applicant_id prevent two access owners for one voucher. UNIQUE delivery.voucher_access_id and guest_checkout_id prevent competing initial-delivery bindings. Immutable bindings and irreversible consumed_at prevent resetting a delivery for reuse. Email is not an ownership key.

The later claim RPC must lock the checkout/access/delivery rows in a consistent order, verify capability digest and expiry/revocation, require pending credentials and unconsumed delivery, then atomically consume delivery and store one newly generated PIN hash/version. Only the winning committed request may receive the new PIN. A losing/replayed request must not receive a different PIN or an applicant session. A lost successful response requires verified rotation. Ordinary subsequent serial/PIN login is a separate operation.

Schema uniqueness is not a completed claim protocol. Two-connection claim races remain to be tested when that RPC exists; the single embedded connection does not demonstrate concurrent locking. No applicant authentication is enabled by 0008.

## Rollback and application boundary

BEGIN/COMMIT makes a failure during this migration roll back its DDL and grants. After a successful commit, leave this additive schema in place if later application deployment fails; there is no automatic destructive down migration. New independent-owner business records remain blocked by legacy NOT NULL constraints. Existing staff authentication and applicant RLS remain in force until a separately reviewed cutover.
