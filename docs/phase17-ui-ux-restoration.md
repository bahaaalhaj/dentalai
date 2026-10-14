# Phase 17 — UI/UX restoration

Local UI/engineering verification completed, 2026-10-14. See
[final evidence and limitations](phase17-final-verification.md). No clinical or
production approval; remote Phase 17 CI was unrun at local verification.

## Baseline and preservation

Started from fetched, merged `main` at `fc9560124bef5a7386017125a69cde4bd166464c`.
Branch: `phase17-ui-ux-restoration`. The pre-existing working-tree photo manifest
was copied byte-for-byte to an ignored preservation checkpoint before builds and
restored afterward. No source edits preceded the baseline checks. The subsequent
handoff authorizes committing only the 71 meaningful changes and pushing this
branch. Merge, deployment, release, history rewriting, artifact deletion and SRS
PDF changes remain prohibited; normalization-only files are excluded.

Baseline: `npm ci` passed (549 packages, zero audit findings); typecheck, lint,
both i18n gates, source gate (218 modules), unit tests (53 web, 104 API), clean database
tests (20), API integration (157 passed, one unconfigured real-S3 skip), coverage
(261 API passed, one S3 skip; web 53), build, bundle and audit passed. Six E2E passed.
API coverage: statements 84.62%, branches 76.84%, functions 88.97%, lines 86.28%.
Web coverage: statements 37.25%, branches 39.23%, functions 26.36%, lines 37.73%.
Baseline bundle: 3,359,952 bytes, 49 files; largest JavaScript 523,963 bytes.

Two baseline environment failures are retained, not hidden: formatting flagged
156 Windows CRLF checkouts despite canonical Git LF; `npm run test:ai` could not find
`uv`. The existing service interpreter passed 15 tests with one upstream Starlette
deprecation warning. The documented uv 0.12.23 was restored without changing the
Python dependency lock. Source/document LF attributes prevent Windows checkout drift;
the existing SQL LF and binary Git LFS attributes remain intact.

## Design and architecture

Keep public landing/login/register and recovery visuals stable. Apply the indigo,
navy, slate and white design system only to authenticated workspaces. Build one
responsive shell with server-identity-derived navigation, clinic context, language,
account and logout controls. Backend authorization remains authoritative.

Historical `b958e6b` DoctorDashboard, PatientDashboard and TeethChart were inspected
only for card, sidebar, chart and SVG visual reference. Their data access, role logic,
automatic tooth states, billing and clinical calculations must not be copied.

Use existing APIs, contracts, icons, native dialogs and Recharts. Dashboard metrics
must identify pagination/scope rather than claim unsupported whole-clinic totals.
Medical codes and clinician-authored text remain verbatim pending terminology review.
Graphical FDI teeth must distinguish unrecorded, unreviewed and explicit approved
findings; selecting or keyboard-focusing a tooth must never save a clinical change.

Private image previews must use authenticated API streaming, not public URLs. Preview
uploaded/validated images rather than decoding unvalidated local medical files.
Uploads show genuine indeterminate activity, not invented completion percentages.

Development CSP will remain bound to explicit loopback development configuration,
allow only the actual trusted Vite preamble and exact HMR origin, and leave production
policies untouched. Consulted [Vite 6 middleware integration](https://v6.vite.dev/guide/ssr)
and [server options](https://v6.vite.dev/config/server-options); no broad inline/eval
or wildcard connection exception is permitted.

## Implemented presentation

The public landing and AuthPage sources remain unchanged. The public recovery frame
retains its default layout; only the embedded authenticated account view changes.
The local shield favicon reuses existing DentalAi branding rather than adding a new
image dependency. No medical, database or API contract is changed.

`shell/AppShell` owns desktop navigation, native-dialog mobile navigation, clinic
selection, user context, locale and real logout. `shell/navigation` derives links
from the server membership DTO. Owner-only operations stay owner-only; a hidden UI
link is not a substitute for backend authorization. All original route guards remain.
Clinic changes key the data screens and discard stale fetches.

`dashboard/useDashboard` fetches the existing permitted scheduling, patient,
administration, financial and patient-projection APIs. Metrics describe loaded pages
(up to 100 appointments per request and 500 accessible patients), not invented
all-time totals. Appointment distribution is lazy-loaded Recharts plus an accessible
textual count list. Financial amounts retain their currency and existing minor-unit
formatter. No treatment/revenue analytics or unsupported invitation count is invented.

Clinical presentation is separated into encounter context, current-record cards,
immutable history, SVG chart and existing validated editors. Search filters only
already authorized names/MRNs. Patient deep links resolve only against that list.
Summary, encounters, notes, chart, plans, imaging and history are keyboard-accessible
tabs. Corrections, approvals, historical reconstruction and reason fields retain the
existing API operations. A patient switch dismisses an unsubmitted review dialog;
submitted review operations disable the selector. Existing stale-save protection is
retained. The anesthesia unavailable notice remains visible on every clinical tab.

The SVG chart renders 32 permanent and 20 primary FDI teeth in fixed anatomical LTR
order, even inside Arabic RTL. Arrows move focus; Enter/click selects. Editable
selection opens the existing unsaved editor, which still requires an explicit valid
action and supported surface selection. Read-only selection only inspects supplied
records. Unknown teeth have dashed outlines/question marks; pending entries are
patterned, with textual review status. Clinical markers require an approved active
finding or approved completed procedure, or the server's approved patient projection.
Clinical codes remain verbatim. A completed procedure is not converted into a finding
or automatically interpreted as health. All prior record versions stay in history.

Imaging is split into upload guidance/drop zone, private preview and study/version
cards. Selected local files are not decoded into previews; the backend validates
magic bytes/dimensions and authorizes streaming before a saved image can be previewed.
Client MIME/size guidance is not treated as security validation. All versions, real
analysis metadata, errors and authorized draft-review actions remain visible.
Missing storage/model availability stays disabled; no detections are fabricated.
Progress is indeterminate actual work, not a made-up percentage. Retry operation keys
remain unchanged until successful completion.

Appointments keep their server offers, revisions, collision rules, timezone utilities
and action authorization, with current-state/today badges. Billing gains snapshot
summary cards and line-item tables while preserving pricing, issued immutability,
refund/adjustment confirmation and internal receipt disclaimers. Administration has
configuration, plan/usage, team, locations, notifications and owner operations tabs;
subscription payment processing remains explicitly absent.

Design CSS is split into shell, components, clinical and responsive/accessibility
modules. New layout styles are scoped to the authenticated shell or new components.
Shared native dialogs, API transport, clinical editors, money utilities and existing
icons are reused. No dependency is added and no coverage/source/bundle/security floor
is reduced. New interface copy has hand-authored English/Arabic counterparts; raw
clinical content and codes are not automatically translated.

## Development CSP boundary

Only explicit `development` node/deployment configuration and a canonical loopback
APP_ORIGIN can mount Vite. The parent HTTP server owns HMR. Vite's trusted
`transformIndexHtml` output supplies the actual React preamble, whose precise bytes
are SHA-256 hashed per HTML response. The only extra connection origin is the exact
matching local ws/wss origin. The local HTML response removes HTTPS upgrade solely
for loopback development. API/assets and production serving do not gain these
exceptions. Missing base CSP fails closed. No unsafe-inline/unsafe-eval script or
wildcard websocket policy is added. The pre-existing style and WASM directives are
not weakened or relabeled as new guarantees.

## Verification boundaries

The new `test:ui` suite uses disposable PostgreSQL, synthetic development fixtures,
private test storage and Chromium. It covers all five roles at 1280/390 pixels in
English/Arabic, native mobile navigation, authorized previews, and actual `npm run
dev` HMR followed by strict-CSP `npm start`. Its independent startup-hook budget
allows migrations/workspace builds; test bodies remain 60 seconds. The original six
E2E tests and their 60-second/300-second limits are retained. Screenshot captures are
software-fixture evidence, not clinical validation or all-browser certification.

Final screenshots and corrected command results are in the Phase 17 final
verification report. Initial assertion/configuration failures and incomplete
concurrent runs are retained there. Baseline passes are not candidate passes.
The real S3 integration skip remains a release blocker. Approved dental model
evaluation and anesthesia reference/golden cases remain clinical blockers.
