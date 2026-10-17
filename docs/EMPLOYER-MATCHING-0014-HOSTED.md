# 0014 hosted verification — PASS

The owner applied 0014. On 2026-10-10 the complete saved catalog matched a fresh local execution: all four function definitions, owners/security configuration, grants, RLS, constraints, triggers, indexes and matching columns/permissions. PostgreSQL's NOT NULL catalog representation difference was normalized; all 229 NOT NULL columns were separately confirmed using hosted metadata.

Evidence: test-results/employer-matching-0014-catalog-comparison.json and test-results/employer-matching-0014-hosted.json. The current SQL checksum is 797d5fa96d27f44a40c7b63f525b65a06d02fd0b5c724ac0bec6b57a2d988d5f. The prior local artifact checksum was stale; the full local pipeline was rerun before comparison, without changing the applied SQL.

Hosted authorization, six concurrent identical employer saves, conflicting retry rejection, applicant RLS isolation, role revocation, research-opportunity match rejection and empty scoped portal results passed. Guest claim, redemption/autosave concurrency, uploads, submission, staff review, notification and logout regressions also passed.

All disposable fixtures were removed; before/after snapshots of all public tables matched. No provider calls, real employer matches, consent or referrals were created. Applicant rollout remains disabled.

Positive consent/referral behavior passed isolated local SQL tests. A positive hosted referral E2E still requires a legitimate authorized employer opportunity; this is not claimed as completed.
