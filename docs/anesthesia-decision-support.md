# Phase 11: blocked, transparent anesthesia decision-support structure

No approved reference set, approved anesthetic formulary, or qualified-clinician-reviewed golden
cases were found in this repository. Existing demo constants and age/organ/smoking multipliers are
not approved references. They have been removed rather than adopted or replaced with invented rules.
This is **not clinically validated** and must not be used for patient-care decisions.

## Safety and architecture

`packages/domain/src/anesthesia.ts` is the single pure production engine. Tests import it directly;
there is no calculator copy in `test_utils`. Zod rejects non-finite/negative/malformed inputs and
unknown properties. `Number.MAX_SAFE_INTEGER` is a software representation bound, not a medical limit.
Positive blood pressure components and systolic greater than diastolic are representation consistency
checks, not hypertension diagnostic thresholds. Physical lb/kg and g/mg conversions are tested but
not used to calculate a patient dose. No clinical dose, cartridge recommendation, smoking-related
increase, age reduction, BP cutoff, organ multiplier or automatic contraindication is implemented.

Rule set `anesthesia-structure-v1`, formulary `unapproved-empty-v1`, reference-set version `null`.
The formulary and approved-reference collections are empty. Environment/demo flags cannot enable
recommendations. No configurable client-supplied rule set or formulary is trusted.

- Invalid representations: validation error, no persistence or numeric result.
- Missing/unreviewed data: `insufficient_data`, explicit missing fields, null dose limits.
- Complete data: `do_not_calculate`, null dose limits, approval-pending warning.
- Contraindications: `not_evaluated`; an empty list must NOT be read as clearance.
- All assessments: immutable drafts. Confirmation returns 409; it cannot override missing references.

The UI retains the DentalAI theme and explicitly states that this is decision support and the
dentist remains responsible for the final decision. The assessment entry/recommendation UI is
intentionally unavailable until clinical requirements are approved; server structure can be tested
without exposing a usable clinical calculator.

## Inputs and provenance

Explicit units: age (years/months), weight (kg/lb), solution concentration (mg/mL), cartridge volume
(mL), vasoconstrictor drug/concentration (mg/mL) or explicit absence, systolic/diastolic pressure
(mmHg). Pregnancy/smoking have explicit unknown states. Allergies, medication names, hepatic,
renal, cardiovascular and other conditions have reviewed flags (reviewed empty means reported none;
unreviewed empty does not mean none). Prior doses carry drug, amount, mg/g units and administration
timestamps. They are captured provenance, NOT a verified completeness guarantee or evaluated history.
These are structural fields, not an assertion that any particular clinical applicability is approved.

The API stores clinician-interview or clinician-record-review source, observed time, server-derived
author/provider/request ID, reason, input snapshot, versioned output, database timestamp and predecessor.
New assessments append corrections/reassessments, never erase old input or output. Normalized patient
allergy/medication records remain in the Phase 8 schema; assessment JSON is an immutable input snapshot,
not a replacement clinical source of truth. No automatic imported history or cumulative exposure window
is inferred. Legacy Supabase recommendations are preserved physically but no longer read or written
by this component, and are not treated as approved assessments.

## API and persistence

- `GET /api/v1/anesthesia/patients/:id`: new-rule-set history only, authenticated active clinic dentist.
- `POST /api/v1/anesthesia/patients/:id/assessments`: strict `AnesthesiaWriteSchema`; creates only a
  blocked draft, not a prescription or successful dose recommendation.
- `POST /api/v1/anesthesia/assessments/:id/confirm`: strict reason; authorized existing draft returns
  `409 RECOMMENDATION_DISABLED`. Non-dentist/other-clinic callers receive safe authorization/not-found
  errors. There is no successful confirmation contract while clinical approval is missing.

Cookie auth, CSRF, body/rate limits, request IDs and safe error handling use existing API middleware.
Every transaction rechecks live session, user, clinic, membership, dentist role and active staff/provider;
clinic/provider/author are never accepted from the browser. An advisory transaction lock serializes
patient versions. Creation and before/after audit insertion commit or roll back together. Rejections
use the existing security-event audit path without logging input in request logs.

Migration `0008_anesthesia_safety.sql` is additive: new-version partial uniqueness, predecessor guards,
immutable-history trigger and unapproved-output/approval guard. Old assessments are untouched. Do not
roll back by deleting clinical data; restore from backup or use a reviewed forward migration.

## Every clinical rule still awaiting approval

1. Reference editions, source licenses, applicability/jurisdiction, named qualified reviewer, approval
   date and version/checksum; formulary product identities and approved labeling.
2. Drug-specific mg/kg and absolute dose limits; applicable age groups and patient weight basis.
   The formerly modeled lidocaine, articaine, mepivacaine and prilocaine products are all unapproved;
   none has been admitted to the new formulary.
3. Approved concentrations, cartridge volumes, vasoconstrictor products/concentrations and limits.
4. Proposed-dose selection, conservative rounding and maximum cartridge arithmetic.
5. Pediatric/geriatric rules and validated age/weight ranges or exclusions.
6. Complete blood-pressure thresholds, repeat measurement requirements and deferral/escalation rules.
7. Allergy/cross-reactivity and excipient contraindications.
8. Pregnancy/lactation applicability and contraindications (lactation input requirements pending).
9. Drug interactions, medication dose/timing details and history completeness requirements.
10. Hepatic, renal and cardiovascular severity stratification, adjustments and contraindications.
11. Smoking applicability; no smoking-related dose increase is permitted by the current engine.
12. Other systemic conditions and approved contraindications.
13. Already-administered doses, exposure windows, mixed agents/additive toxicity, vasoconstrictor
    cumulative exposure and missing/uncertain exposure rules.
14. Warning severity, contraindication escalation, insufficient-data requirements and allowed outcomes.
15. Confirmation, rejection, correction and patient-portal release policies for an actual recommendation.
16. Clinician-reviewed golden cases, boundary cases, unit conversions/rounding tolerances and independent
    clinical validation before enabling any numeric recommendation.

No approved golden cases were invented. Software validation/property tests do not establish clinical
safety or approved clinical accuracy. Work stops after Phase 11.
