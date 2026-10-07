# Supabase-to-PostgreSQL mapping proposal

This is a mapping and review plan, not an executed migration. Supabase remains functional in Phase 4,
and frontend features still use their existing Supabase paths. No legacy data has been copied or
deleted.

| Current Supabase source | New PostgreSQL target | Required transformation and review |
| --- | --- | --- |
| `auth.users` | `users`; later `sessions` | Preserve identity correlation in migration tooling. Password/session migration depends on the future identity provider and is unresolved. |
| `profiles` with `role = 'doctor'` | `users` + `memberships` + `membership_roles` + `staff` + `providers` | Split global identity, clinic membership, authorization, employment, and provider credential data. Assign a clinic explicitly. |
| `profiles` with `role = 'patient'` | `patients`; optional `portal_user_id -> users` | A patient is a clinical record, not necessarily a login. Deduplicate before assigning clinic-scoped MRNs. |
| `appointments` | `appointments`, `appointment_types`, `appointment_status_history` | Resolve clinic/location/provider/type. Convert separate date/time into an explicit zoned instant. Map `booked` to `scheduled`; preserve cancellation/completion as history. Never cascade-delete. |
| `medical_records.medical_history` | `clinical_notes`, `medical_alerts`, `allergies`, `medications` | Parse only with clinician-approved rules. Otherwise retain source text as a versioned legacy note for review. |
| `medical_records.teeth_status` | `odontogram_findings`, `odontogram_finding_surfaces`, `procedures`, `procedure_surfaces` | Validate tooth vocabulary and distinguish observations from performed/planned procedures before import. Keep the source JSON in a migration audit artifact. |
| `xray_images.image_url` | `files`, `xray_studies`, `xray_study_files` | Copy into private object storage, calculate SHA-256, record size/type, and verify before marking available. The old public bucket policy must not be reproduced. |
| `xray_images.ai_report` | Quarantined migration artifact; possibly `ai_analysis_runs` only after provenance review | Do not treat legacy simulated/random JSON as findings. Import no run as `succeeded` without real model provenance, result artifact, and explicit review policy. |
| `anesthetic_recommendations` | `anesthesia_assessments` | Use a `legacy-unvalidated` rule-set marker and a non-approved state if retention is authorized. Never convert old recommendations into approved clinical decisions automatically. |
| `procedure_prices` | `services`, `price_lists`, `price_list_items` | Map procedure names to stable service codes. Confirm what `price_sp` means, its currency, and minor-unit conversion before importing. |
| `payments` | `invoices`, `invoice_items`, `payments`; possibly a legacy unapplied-payment workflow | Determine currency and whether each amount is linked to an invoice. Convert to integer minor units only after scale review. Preserve source IDs in migration logs. |
| `storage.objects` in `xrays` | `files` plus private S3-compatible objects | Copy, hash, malware-scan, verify, then switch references. No public-read policy in the target. |
| Supabase RLS policies and `is_doctor()` | Future API authorization and PostgreSQL RLS policy set | Do not translate one broad doctor role directly. Map least-privilege role permissions after authentication design. |
| Realtime publications | Transactional outbox and later API delivery | Define consumers and delivery semantics later. Phase 4 only provides `outbox_jobs`. |

## Proposed migration sequence

1. Freeze and export a checksum-addressed source snapshot without changing the live frontend.
2. Establish clinic identities, location/timezone, currencies, and role vocabulary.
3. Import users/memberships/providers and patients with deterministic source-to-target ID mapping.
4. Import historical appointments with explicit timezone conversion and reconciliation reports.
5. Transform clinical data only under an approved clinical mapping; quarantine ambiguous JSON.
6. Copy X-ray objects privately and verify hashes before importing study metadata.
7. Import billing only after currency/minor-unit decisions are signed off.
8. Reconcile row counts, orphan reports, money totals, object hashes, and sampled clinical timelines.
9. Migrate application features in a later phase; Supabase removal is explicitly outside Phase 4.

Every import should emit append-only audit evidence and be repeatable in a disposable environment before
any production cutover.
