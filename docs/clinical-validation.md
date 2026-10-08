# Experimental Clinical Modules

The X-ray analysis and anesthetic decision-support modules are experimental. They have not completed technical or clinical validation and must not be used to diagnose, recommend treatment, calculate a patient dose, or make any other patient-care decision.

Both modules are disabled by default. Development or demonstration access requires `VITE_CLINICAL_ENV` to be explicitly set to `development` or `demo` and the module's individual flag to be set to `true`:

- `VITE_ENABLE_XRAY_ANALYSIS`
- `VITE_ENABLE_ANESTHETIC_DECISION_SUPPORT`

The browser X-ray analyzer never produces findings; Phase 10 supplies a separately configured private inference service, not a demo simulation. Anesthetic recommendations remain disabled even in development/demo: Phase 11 found no approved clinical reference set, formulary or golden cases. See [anesthesia decision support](anesthesia-decision-support.md) for the versioned, fail-closed structure and every pending clinical rule.

## Phase 8 clinical-record workflows

This phase implements clinician-authored record keeping, **not** diagnosis, automated treatment
selection, clinical decision support or an inference service. Nothing here validates the experimental
modules above. The theme and appointment/account flows are preserved; billing/file migration is not
part of this phase.

### Roles and patient projection

- Clinical directory, records, encounter creation/closure, corrections and approval require an active
  `dentist` membership and active staff/provider record in the authenticated clinic. Owner/admin or
  receptionist status alone grants no clinical-record access. Every transaction revalidates and locks
  live session, user, clinic, membership and role/provider state.
- A patient can only read the portal projection for the patient entity explicitly linked to their
  authenticated user in their active clinic. The portal accepts no patient/clinic/user override.
- Save a draft first; explicitly approve or reject it with a reason. The author may self-approve;
  two-person review is **not** claimed. The approver must be an active dentist. A revision can be
  reviewed once and only while its encounter is open and the revision is current.
- Drafts, rejected entries, internal review/change reasons, membership IDs and the retained legacy
  archive never enter the patient projection. A pending/rejected correction does not replace the last
  approved version. Approved corrections replace the current portal entry; earlier approved versions
  remain read-only history labeled superseded. Entered-in-error findings/procedures are excluded from
  current portal records but remain historical evidence.

### Explicit odontogram and tooth notation

New records use the two-digit FDI / ISO 3950 designation, not Universal numbering. The
[ISO standard summary](https://www.iso.org/standard/68292.html) describes the two-digit system;
the [standard preview](https://cdn.standards.iteh.ai/samples/68292/f72969b198e44f7fbe1caa1347eca0e6/ISO-3950-2016.pdf)
documents quadrant and tooth-position designation.

- Permanent quadrants: 1 upper right, 2 upper left, 3 lower left, 4 lower right; position 1–8 from
  the midline. Primary quadrants: 5 upper right, 6 upper left, 7 lower left, 8 lower right; position 1–5.
  These are the patient's right/left. Supernumerary teeth and oral-area codes are not supported yet.
- Surfaces: M mesial, D distal, L lingual/palatal, F facial for anterior teeth, B buccal for posterior
  teeth, I incisal for anterior teeth, O occlusal for posterior teeth. This application's explicit
  vocabulary uses I/F for positions 1–3 and O/B for posterior positions; it does not claim those
  surface abbreviations are prescribed by ISO 3950. Duplicate/unknown/inapplicable surfaces are rejected.
- A missing tooth has no surfaces. Whole-tooth/unspecified-surface findings are allowed deliberately,
  not inferred. A general `other` procedure may omit a tooth; named tooth procedures require one.
- Clicking/keyboard-selecting a tooth only fills the editor. The clinician explicitly selects a finding
  or procedure action and saves with a reason. Procedures never silently convert findings or generate
  charges. No record means unknown, not healthy; an explicit healthy finding is a clinician observation.
- Finding, allergy, medication, procedure and plan statuses have explicit transitions in production
  domain rules. Same-state edits are documented corrections. Procedure completion records the server
  timestamp and retains it across subsequent same-state corrections. No browser-supplied authorship,
  approval, clinic or clinical timestamp is accepted.

### Revisions, history and normalized storage

Migration `0005_clinical_workflows.sql` is additive. The existing normalized note/alert/allergy/
medication/finding/procedure/plan/item/surface tables remain the content source. New immutable
`clinical_revisions` rows hold clinic, patient, encounter, author, server timestamp, reason, group,
version and predecessor. `clinical_approvals` is an append-only decision ledger. Demographic versions
are normalized in `clinical_demographics`; approved versions update the canonical patient row in the
same audited transaction. Plan-item surfaces are separate rows, and estimates use integer minor units
plus an explicit currency; this is not billing automation.

The workflow ledger is authoritative for new record version/current/review state. For compatibility,
new clinical-note payloads retain `status=draft` and `is_current=false`; do not use those legacy columns
to determine Phase 8 approval or current content. API projections derive those facts from the ledger.
Plan snapshots preserve item sequence within each version; reordering/replacing an item with a different
service/tooth is a new planned item. There is no procedure execution inferred from a plan-item status.

Corrections append content and supersede the current revision with optimistic predecessor checks;
concurrent successors cannot branch. SQL constraints enforce same-clinic/patient/encounter references,
version chains, one successor and one review. Deferred checks require matching normalized content and
atomic audit evidence. Content, surface/item children, revision metadata and approvals cannot be changed
or deleted after commit. Append-only audit events record patient, actor, reason and before/after data.
All API writes and their audit evidence commit or roll back together.

Encounter closure is explicit, audited, and blocked while current entries await review. Signed visits
cannot be edited. Correct earlier information in a new open visit. An as-of encounter selector uses
the closed visit's server signing timestamp, includes only revisions at/before that cutoff, and
excludes later approvals. The readonly legacy archive is deliberately **not** an as-of reconstruction.
Cutoffs retain PostgreSQL microsecond precision, not a rounded browser timestamp. Patient-serialized
clinical mutations use an observed database timestamp and reject a clock regression with a recoverable
`409 CLINICAL_CLOCK_CONFLICT`, with no write or audit mutation committed. No synthetic future timestamp
is substituted. Operators must keep the database clock synchronized; retry after correcting it.

### Cutover limits and preservation

No hosted Supabase data was read, imported or deleted. No historical authorship or missing states were
invented. Older self-hosted normalized rows remain visible in the clinician-only read-only archive;
they require reconciliation and never auto-publish. A single overwritten Supabase row cannot recover
lost past states without source backups/audit exports. Preserve/export every available source version
and raw tooth code before importing; never silently reinterpret a bare `11` from the old 1–32 chart
as FDI `11`. See the [source mapping](migration/supabase-to-postgresql.md).

The migrated browser `medical_records`/`teeth_status` queries, subscriptions, upserts and click-cycling
handler are retired, including the billing dependency that priced tooth states. Legacy billing totals
are explicitly unavailable, not fabricated as zero. Supabase remains installed for unmigrated billing,
files and experimental-tool storage. Legacy dashboards remain unrouted; the new focused clinical pages
are routed separately from appointments. Clinical code uses only the typed backend client, no Supabase.

Back up and restore-test before deployment. No destructive down migration is provided; rolling the
application back must retain these tables/ledgers and block incompatible writers. Verify hosted legacy
policies separately; frontend migration does not revoke old cloud access. Patient registration/linkage,
legacy import provenance, retention, least-privilege DB roles and production security approval remain
operator decisions. The initial clinician directory is capped at 500 rows; larger deployments need
directory pagination/search before rollout.

### Phase 8 verification coverage

The new unit tests exercise the actual shared contracts, domain rules, typed client and focused React
components, not test-only clinical implementations. Coverage includes FDI/surface validation, explicit
actions, transitions, populated control labels, prefilled correction accessibility, retained drafts,
and rejecting stale save responses after selecting another patient.

Integration tests run the production router, authentication, repository and reviewed migrations against
generated disposable PostgreSQL databases. They cover approved-only projections, earlier-encounter
reconstruction, every clinical route's tenant/role checks, revoked sessions/inactive providers,
concurrent successor/review conflicts, audit failure rollback, immutable content and child rows,
required normalized payloads, retained legacy archives, malformed/oversized requests and safe errors.
The clock-regression test inserts fictional future legacy history; it does not alter the host clock.
Clinical changes and their audit events share the same observed server timestamp, with completion
timestamps retained across subsequent corrections.

The production-browser flow uses separate clinician/patient sessions with fictional data. It proves
draft privacy, explicit keyboard tooth selection without a write, approval, unpublished corrections,
approved version history and read-only patient access. The existing appointment browser flow remains.
The clinical browser helper allows at most four explicit retries **only** after observing a rolled-back
`CLINICAL_CLOCK_CONFLICT` and its visible recoverable error. It waits for the database clock to advance;
any other response/error fails immediately. No API response, inference or Supabase result is fabricated.
CI runs verification groups sequentially. UI test workers are capped at two without suppressing errors
or changing test timeouts; simultaneously running database, browser and UI checks locally caused a
5-second UI-test timeout during development.
The existing auth-guard test preloads the real auth screen so its assertions do not depend on
lazy-import disk latency. The screen and authorization assertions remain unmocked.

### Local command results — 2026-10-08

Environment: Windows/PowerShell, Node 24.19.0, npm 11.17.0, PostgreSQL 17.11 in an isolated disposable
Docker container. Only fictional seed/fixture records were used; no live Supabase or external patient
services were contacted by tests. These are local results, not a claim that remote GitHub Actions ran.

| Command                                                                                  | Final exit/result                                                                                                                |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Baseline `npm run verify`, before Phase 8 changes                                        | 0; 65 unit tests, typecheck/lint/format/build and high-severity audit passed                                                     |
| `npm ci`                                                                                 | 0; 513 packages added, 520 audited                                                                                               |
| `npm run verify`                                                                         | 0; typecheck, lint, formatting, 89 unit tests (48 web + 41 API), production web/API/shared builds and high-severity audit passed |
| `npm run test:db` with a disposable `DATABASE_URL`                                       | 0; 19 migration/constraint/upgrade tests + 92 API integration tests passed                                                       |
| `npm run test:e2e` against the production web build                                      | 0; existing appointment flow and new clinician-approval/patient-history flow passed (2 tests)                                    |
| `npm audit --json`                                                                       | 1; four existing moderate findings, zero high/critical                                                                           |
| `npm run audit` (`--audit-level=high`)                                                   | 0; moderate findings remain                                                                                                      |
| Pinned Gitleaks 8.30.1, working diff and all new source files, redacted/network disabled | 0; no leaks found                                                                                                                |
| `git diff --check`                                                                       | 0; no whitespace errors                                                                                                          |

The final test total is 202, including 47 net additional tests over the baseline. Initial intermediate
runs exposed SQL/response validation issues, control-label defects, the local database clock rollback,
and test-worker/import timing failures; these were corrected and rerun. The final sequential quality
gate passed without suppressing errors or increasing test timeouts. Production build retains two
non-fatal Zod/Rollup comment-annotation warnings.

No external dependency versions changed. Contracts now reference the existing domain workspace; the
package build order puts domain before contracts. Remaining audit findings are the development-tool
chain `esbuild` → `@esbuild-kit/core-utils` → `@esbuild-kit/esm-loader` → `drizzle-kit`. No forced
upgrade was run. The test container and generated databases were removed; unrelated containers,
application infrastructure volumes, historical records, datasets and model weights were untouched.

Primary changed areas: `packages/contracts/src/clinical.ts`, `packages/domain/src/clinical.ts`,
`packages/database/src/schema/clinical-workflow.ts`, migration `0005` and its metadata,
`apps/api/src/domains/clinical/`, `apps/web/src/clinical/`, typed client and route/account wiring,
the clinical unit/integration/browser tests, CI and these setup/security/migration notes. Only the
migrated medical-record/tooth-state Supabase queries/subscriptions/writes/types and their obsolete
chart/test-only helpers were retired. Deleted source files remain recoverable from Git. Unmigrated
Supabase billing/file/experimental paths and the package remain; tooth-derived billing estimates are
explicitly unavailable rather than replaced with invented amounts.
