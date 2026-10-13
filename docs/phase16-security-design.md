# Remaining security gates and implementation design

Application-layer tenant checks and composite foreign keys are implemented; **PostgreSQL RLS is not implemented**. MFA and a verified breached-password policy are also absent. None is approved by Phase 16 fixture tests. Adding partial policies to the shared authentication/domain pool would risk failing login, onboarding, exports or background delivery; these must remain blockers until the following staged changes are verified.

## Database RLS migration plan

1. Inventory global auth/session tables versus tenant-owned tables, existing SECURITY DEFINER functions, migration role, workers and bootstrap/onboarding. Record grants and tenant access per query.
2. Separate migration-owner, global auth, tenant application and scoped worker connection roles/pools. The runtime must have no BYPASSRLS/table ownership. Global auth cannot read clinical/financial tables. Workers must not inherit unrestricted tenant reads.
3. Add a transaction helper that validates current session/membership first and then executes `SET LOCAL dentalai.clinic_id` using safely parameterized `set_config(...,true)`. Missing tenant context fails closed. Never derive the value from a browser clinic header or URL alone.
4. Add reviewed `ENABLE` and `FORCE ROW LEVEL SECURITY` policies on every tenant-owned table, both USING and WITH CHECK. Privileged multi-tenant exports/recovery/onboarding require narrow audited functions or per-tenant transactions, not blanket runtime bypass.
5. Prove isolation on reads/inserts/updates/deletes, role revocation during requests, cross-tenant FK/joins, pooled connection reuse after commit/rollback, workers, onboarding and migrations. Run upgrade and clean restore drills with the actual restricted roles before enabling policies in a pilot.

Until this plan passes, application filters must not be described as database isolation through RLS.

## MFA and password-protection plan

Use the maintained authentication provider's reviewed MFA implementation rather than custom TOTP crypto. Require enrollment and step-up for owners/admins (membership changes, export/offboarding and subscription administration), then dentists according to a reviewed clinical-access policy. Store the provider's encrypted enrollment secret with separate key management; hashed single-use recovery codes; audited enrollment/recovery, rate limits and session revocation. Include enrollment/confirmation, reset/recovery and session UX in both languages.

Migration must distinguish existing non-enrolled accounts, enrollment grace states, locked sensitive operations and approved support recovery. No fake enrolled flag or universal bypass. Tests must cover session fixation, stolen session without second factor, recovery replay, concurrent code reuse, cross-tenant role changes and provider upgrades.

For breached/common passwords, choose a maintained, licensed local hash corpus or explicitly approved k-anonymity service; document updates, availability, privacy and registration/reset/enrollment enforcement. Do not ship an arbitrary short list and claim comprehensive protection. Passwords, OTPs, tokens, recovery codes and query prefixes must not enter logs/audit payloads. Review password-change/session-revocation tests with the provider before rollout.

## Unresolved external verification

Independent penetration testing, real S3/KMS privacy checks, dataset rights and clinical validation, container vulnerability clearance, actual TLS/DNS/SMTP, alert routing, off-site backup and measured RPO/RTO, a production restore and operational approval remain required. Secret-scanning or local synthetic restore results do not replace these gates.
