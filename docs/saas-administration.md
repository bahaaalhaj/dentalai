# Phase 13 administration (not production deployment)

No payment processor is selected and no subscription payments/receipts are fabricated.
Clinical gates are unchanged; no clinical approval or deployment is claimed.

## Onboarding and authority

Verified accounts may attest authority and create one **new isolated** clinic. The server
generates its tenant and owner membership; public registration stays patient-only and an
owner gains no dentist privilege. Additional clinics, owner transfer/recovery and legal
ownership verification require operator review. Attestation is not legal verification.

Defaults: one location/chair, consultation type, Monday–Friday 09:00–17:00 local hours.
Review these, invite a dentist and configure services before booking. Owners/admins can
configure identity, initials/color branding, contacts, currency, IANA timezone, locale,
locations, hours and services. Scheduling/pricing screens remain linked and functional.
Currency changes affect defaults only, never historical prices/invoices. Branding applies
to the administration header, not a replacement product theme.

Owners manage non-owner staff roles/status; admins cannot manage peer admins or promote
to admin. Owner/self changes and patient-only upgrades are prohibited; use invitations.
Sessions/memberships/clinic are rechecked in transactions. Suspensions preserve history,
revoke selected-clinic sessions and pending invitations issued by that member; other
sessions have live roles recomputed each request.

## Administrative provider and server quotas

`SubscriptionBillingProvider` currently has an `AdministrativeSubscriptionProvider`.
Patient invoice payments remain a separate unchanged ledger. Owners request plans,
schedule cancellation or resume unexpired cancellation; requests do not upgrade limits.
Only a server operator may grant state, with append-only subscription and audit events:

```bash
npm run subscription:admin -- UUID team activate "Reviewed administrative grant" --ack-no-payment
```

Actions: `activate` (30-day grant), `past_due` (7-day grace), `suspend`, `cancel`.
This requires server configuration/database access, not an HTTP activation route.

| Plan                               | Staff seats | Active locations | Bookings / UTC month |    Reserved bytes |
| ---------------------------------- | ----------: | ---------------: | -------------------: | ----------------: |
| Starter                            |          25 |                2 |                  100 |        52,428,800 |
| Team                               |          50 |               10 |                1,000 |     1,073,741,824 |
| Existing-clinic grant (not public) |      10,000 |           10,000 |            1,000,000 | 1,099,511,627,776 |

New clinics get 14-day trial plus 7-day grace. Additive migration 0009 grants existing
clinics the finite existing-clinic limits with active state/no expiration, preserving
earlier behavior **without payment evidence**. Expired/suspended/cancelled state blocks
new capacity, not clinical corrections, cancellations, history reads or reconciliation.
Scheduled cancellation ends growth at period end without grace.

PostgreSQL triggers enforce quotas under a tenant advisory lock. Production transactions
take it before authorization row locks. Pending unexpired invitations reserve seats;
active staff count once. Acceptance releases reservation and grants the role atomically.
Reactivation consumes quota; cancelled bookings still count by creation month. All reserved
file rows count, including failed uploads; reconcile explicitly without deleting history.
No broker/Redis is added.

## Notifications

`NotificationProvider` wraps real SMTP/private development mail. Delivery, outbox and
audit enqueue in the business transaction. AES-256-GCM encrypts messages with a key derived
from server-only `AUTH_SECRET`; outbox holds delivery IDs, never clear tokens. Pending
messages need reviewed re-encryption/reissue during key rotation. Server/DB access is sensitive.

New configurations enable `OUTBOX_WORKER_ENABLED=true`; existing settings are not overwritten.
Enable it explicitly and restart to deliver queued invitations. Production needs SMTP and
an operational worker. Authentication verification/reset still uses its direct maintained
adapter. Members control their own operational preference, not required security/invitation mail.

The worker uses PostgreSQL leases and up to eight attempts at the polling interval. History
shows state/provider/attempts/timestamps; audits retain each processed/failed attempt. Accepted
means provider acceptance, not inbox delivery. Delivery is **at least once**: a crash after
SMTP acceptance may duplicate mail. Providers supporting idempotency receive the delivery UUID.
Exhaustion requires operator investigation/reissue; no webhook/exactly-once claim. Revoked/
expired invitations and inactive clinic/recipient deliveries are skipped. Errors are generic.

## Export, offboarding and rollback

Owner-only export/offboarding requires sign-in within 15 minutes. Repeatable-read tenant
exports are capped at 10,000 rows/table, 50,000 total rows and 20 MiB table JSON, three
requests/minute; larger clinics need operator streaming. Exports include clinic/clinical/
financial history, relevant member identities, counts and SHA-256 of
`JSON.stringify({tables,files})` in manifest order. Credential/session tables, token hashes,
notification ciphertext, object keys and outbox payloads are excluded.

A manifest is **not a file backup**. Download every file via the recent-owner authenticated
`GET /api/v1/admin/export-files/{id}`; it checks tenant/checksum and returns an attachment
with `private, no-store`. Save JSON/files securely before offboarding; saving is a manual
obligation, not proven by the server. Completion requires owner request, same-owner export
within 24 hours and exact clinic name. It deactivates clinic/subscription, revokes pending
invitations, clears selected contexts and audits reason; no records/identities/objects deleted.
After deactivation exports require operator recovery. Legal hold, retention duration, erasure/
purge and recovery policy need approval and are deliberately not automated.

Migration 0009 is additive reviewed SQL. Tenant rows contain `clinic_id`; global plans do
not. Drizzle includes tenant FKs/checks; SQL triggers are authoritative. Keep DB/private-object
backups together. Rollback restores verified pre-upgrade backups or retains additive schema
while reverting code; never drop quota functions/tables beneath running applications.
No production cutover, Phase 12 reset, legacy data removal or model-artifact deletion occurs.

## English/Arabic preparation

`apps/web/src/i18n/` holds a complete typed bilingual administration catalog, mechanical
English inventory/source references and hand-written common Arabic interface dictionary.
`i18n:extract` inventories display strings, **not translations**; review the diff.
`i18n:check` guards static JSX/messages/direct display templates. Saved enums, technical
values, user content and formulas are intentionally excluded. Demographic/day labels are explicit.

Selector preference persists; otherwise clinic locale applies. Document `lang`/`dir`,
logical spacing, and numeric/email/date input direction support RTL. FDI spatial ordering
stays `ltr`, not mirrored anatomy. Arabic uses local system fonts without external requests.
Clinical wording/status codes stay English with a review notice; **no automatic medical
translation**. Professional terminology/assistive-technology/manual visual review remain
release gates beyond layout smoke tests. See [verification](phase13-verification.md).
