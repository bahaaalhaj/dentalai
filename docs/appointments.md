# Backend-owned scheduling (Phase 7)

Appointments and availability now use authenticated `/api/v1` contracts and self-hosted PostgreSQL.
Open **Appointments and calendar** from the account dashboard. The patient view offers booking,
rescheduling, cancellation, upcoming/history lists, and an audit timeline. The staff calendar adds a
location-local date filter and authorized status actions. Native modal dialogs and live notifications
replace appointment browser alerts/confirmations. The existing slate/indigo theme is retained.

Clinical records, billing, private files and anesthesia now use their own local API domains.
The clinical-safety freeze remains. Phase 12 intentionally replaces disposable test data, not
historical records; see [the reset report](phase12-test-data-reset.md). No legacy public-policy
setup script remains in the deployment path.

## Setup and ownership

1. Follow the root README: install, configure server-only PostgreSQL/auth/SMTP values, start local
   infrastructure, and run `npm run db:migrate --workspace @dentalai/database`.
2. Provision the first owner with the Phase 6 operator command. Clinic/location identities and IANA
   timezones must already be provisioned in PostgreSQL; location creation is not a new public endpoint.
3. Invite a dentist using the account dashboard. Accepting a dentist invitation creates the existing
   staff/provider records; revoked/disabled memberships or users cannot receive new slots.
4. Owners/admins open **Clinic scheduling settings** to add chairs, appointment types/durations,
   general and optional provider working hours, closures, and lead-time/horizon policy.
5. Booking requires a non-archived clinical `patients` row. Patients require an explicitly assigned
   `portal_user_id` in the same clinic. Public registration does not create or link a clinical patient.
   Patient linkage and any legacy import still require a reviewed operator process. Staff booking
   currently accepts an existing clinic patient-record UUID; a clinical patient directory is not
   being migrated in this phase.

The root `dev:seed` creates clearly synthetic local-only identities and hashed, privately generated
credentials, never real users or cloud password hashes. Tests create disposable databases and use
real local API sessions. The seed already configures providers, hours, chairs and linked patients.

## Authorization and transport

| Actor              | Appointment scope                                                                               | Allowed changes                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Patient            | Only records whose patient entity is explicitly linked to that user in the authenticated clinic | Book own patient entity; reschedule or cancel own future scheduled/confirmed appointment                             |
| Dentist            | Only appointments assigned to their own active provider membership                              | Staff booking for permitted clinic patient entities; confirm, reschedule, cancel, no-show, check-in, start, complete |
| Receptionist       | Authenticated clinic                                                                            | Staff booking, confirm, reschedule, cancel, no-show, check-in; never start/complete                                  |
| Clinic owner/admin | Authenticated clinic                                                                            | All scheduling actions and configuration                                                                             |

Every request rechecks the server session, enabled user, active clinic membership, and roles. Mutations
also lock the authorization rows for the transaction. The browser cannot supply an authoritative
clinic, provider, chair, duration, confirmation/completion state, or user identity. Staff booking alone
accepts a patient entity selector and validates its clinic. Patient bodies are strict Zod objects.
Mutations require the existing CSRF protection. Responses are schema-validated and `Cache-Control:
no-store`; protected failures do not expose complete database rows or database error details.

Actual contracts generate OpenAPI at `/api/v1/contracts/v1?format=openapi`. Main routes are
`GET /scheduling/catalog`, `GET /scheduling/availability`, `GET/POST /appointments`,
`POST /appointments/staff`, `GET /appointments/:id`, `GET /appointments/:id/history`,
`POST /appointments/:id/actions`, and `POST /appointments/:id/reschedule` (all prefixed `/api/v1`).
Admin configuration uses `/scheduling/operatories`, `/types`, `/hours`, `/closures`, and `/policy`.
There is no appointment DELETE endpoint.

## Availability and transactions

Authenticated availability is anonymized, not a public appointment-row feed. Slots contain only an
opaque token, UTC start/end instants, and the location timezone. Responses contain no patient ID,
patient name, appointment ID, notes, provider ID, or chair ID. Patient catalogs also omit private
provider/chair/hour/closure configuration. New bookings return only the authorized patient's own
appointment, including display names for its resources; staff DTOs additionally contain the patient
record ID/name.

The server chooses one deterministic free active provider/chair combination for each offered start
time. Tokens contain 32 random bytes, are stored only as SHA-256 hashes, expire after five minutes,
are user/clinic-bound, and are single-use. A token is **not a reservation**. At booking the server
revalidates resources, duration, timezone, working hours, lead time and horizon. One transaction
locks the clinic scheduling key, rechecks authorization, resolves the permitted patient, locks the
offer, inserts the appointment, consumes the offer, and commits the database-generated audit/history
events. A collision rolls everything back and returns 409; it does not fabricate a booking.

PostgreSQL's existing GiST exclusions prevent overlapping patient/provider/chair appointments using
half-open `[start, end)` intervals. Existing schedule-block triggers and new closure triggers check
cross-table collisions in both directions. Database advisory locks serialize these checks, including
direct SQL callers. Phase 7 uses a conservative clinic-wide scheduling lock; higher-throughput locking
is a future measured optimization, not a reason to weaken constraints. Cancellation/no-show release
resources without deleting the appointment. Completed appointments retain historical reservations.

Expired/consumed offer rows are ephemeral transport state, not clinical history. Deployments should
schedule bounded deletion of expired offers (e.g. batches selected through the expiry index). No
appointment/audit/history cleanup is permitted. Distributed workers/Redis were not added.

## State and history rules

| From                            | Permitted next states                     |
| ------------------------------- | ----------------------------------------- |
| scheduled                       | confirmed, cancelled, no_show             |
| confirmed                       | checked_in, completed, cancelled, no_show |
| checked_in                      | in_progress, completed, cancelled         |
| in_progress                     | completed                                 |
| completed / cancelled / no_show | None                                      |

Confirmation must occur before start. Patients can cancel only future appointments. Cancellation and
no-show require a reason. No-show/start require start to have passed; check-in opens 15 minutes before
start; completion requires end to have passed and a clinical staff role. Owners/admins retain scheduling
authority but these checks do not constitute clinical approval.

Rescheduling is restricted to future scheduled/confirmed appointments, retains patient/type identity,
and resets confirmation to scheduled. Optimistic `revision` guards stale actions (409). SQL guards
reject deletion, identity changes, terminal-state transitions, historical rescheduling, and changes
to terminal historical timezone/resource fields. Database triggers append status history and audit
events with before/after instants/resources, actor membership/user and request ID on every booking,
status change, and reschedule. Administrative configuration changes also write audit events.

## Timezone policy

Persist UTC `timestamptz` instants plus the appointment's explicit IANA location timezone. Working
hours are local wall times, Sunday=0. General clinic hours are required; provider-specific schedules,
when present, narrow them. Missing hours mean closed; there is no hardcoded Friday holiday or browser
slot list. Durations are elapsed minutes; starts use a 15-minute grid anchored at opening.

`packages/domain` uses the Temporal polyfill for date-only arithmetic, local-day boundaries and
display. No appointment flow parses `YYYY-MM-DD` through `new Date(...)`. Short/long DST days are
23/25 elapsed hours. Nonexistent or ambiguous wall times, and slots crossing an offset transition,
are deliberately not offered. Closure wall-time conversion rejects ambiguity rather than choosing
an offset. Multi-day/overnight hours and recurrence are not implemented; use explicit daytime hour
rows and absolute closure intervals. Existing booked instants are not shifted after timezone/hour
configuration changes.

Provider hours are intersected as time intervals, not as a second independently anchored slot grid:
for example, clinic hours starting at 09:00 and provider hours starting at 09:10 allow a 09:15 clinic
slot that fits completely inside both windows. Cancellation/no-show reasons are retained in the
append-only transition audit; terminal cancellation and creation provenance cannot be rewritten.

## Verification

```bash
npm ci
npm run verify
# DATABASE_URL is server-only; tests create/drop UUID-named fictional databases.
export DATABASE_URL='<disposable-postgresql-connection-url>'
npm run test:db
npx playwright install --with-deps --no-shell chromium
npm run test:e2e
```

In PowerShell, set the test connection with `$env:DATABASE_URL = '<disposable-postgresql-connection-url>'`
instead of `export`. The fixture requires a database role permitted to create/drop its temporary
databases; do not point the tests at a production instance.

Browser tests serve the real production web bundle from the real API and authenticate fictional
patients/staff against disposable PostgreSQL. They do not mock appointment/auth HTTP calls. Tests
cover patient booking, staff confirmation, patient refresh/cancellation, retained history and audit,
and native dialog Escape dismissal. Integration tests also race direct PostgreSQL writes, race
closures against bookings, test authority injection, each role and clinic boundary, revision/offer
expiry, changed hours/blocks, patient linkage, terminal history, and completion/no-show timing.

See [phase7-verification.md](phase7-verification.md) for exact run results and remaining deployment
decisions. No later phase, clinical migration, automatic legacy-data import, or clinical validation
is included.
