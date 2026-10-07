-- Hand-reviewed PostgreSQL invariants that are not represented by Drizzle's
-- portable schema DSL. Keep this migration SQL-visible and review changes to it.

CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_timezone_exists(candidate text)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = candidate)
$$;--> statement-breakpoint

ALTER TABLE "clinic_settings"
  ADD CONSTRAINT "clinic_settings_lead_minutes_chk" CHECK ("appointment_lead_minutes" >= 0),
  ADD CONSTRAINT "clinic_settings_horizon_days_chk" CHECK ("appointment_horizon_days" BETWEEN 1 AND 3650);--> statement-breakpoint
ALTER TABLE "clinics"
  ADD CONSTRAINT "clinics_timezone_name_chk" CHECK (dentalai_timezone_exists("default_timezone"));--> statement-breakpoint
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_timezone_name_chk" CHECK (dentalai_timezone_exists("timezone"));--> statement-breakpoint
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_timezone_name_chk" CHECK (dentalai_timezone_exists("timezone"));--> statement-breakpoint
ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_timezone_name_chk" CHECK (dentalai_timezone_exists("timezone"));--> statement-breakpoint

CREATE UNIQUE INDEX "operatories_clinic_id_location_uidx"
  ON "operatories" ("clinic_id", "id", "location_id");--> statement-breakpoint
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_operatory_location_tenant_fk"
  FOREIGN KEY ("clinic_id", "operatory_id", "location_id")
  REFERENCES "operatories" ("clinic_id", "id", "location_id")
  ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_operatory_location_tenant_fk"
  FOREIGN KEY ("clinic_id", "operatory_id", "location_id")
  REFERENCES "operatories" ("clinic_id", "id", "location_id")
  ON DELETE RESTRICT;--> statement-breakpoint

-- Foreign keys below close tenant-boundary gaps for references that cross
-- schema modules or form self-referential version chains.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_tenant_fk"
  FOREIGN KEY ("clinic_id", "invited_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_tenant_fk"
  FOREIGN KEY ("clinic_id", "cancelled_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_created_by_tenant_fk"
  FOREIGN KEY ("clinic_id", "created_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_signed_by_tenant_fk"
  FOREIGN KEY ("clinic_id", "signed_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_supersedes_tenant_fk"
  FOREIGN KEY ("clinic_id", "supersedes_note_id") REFERENCES "clinical_notes" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "medical_alerts" ADD CONSTRAINT "medical_alerts_recorder_tenant_fk"
  FOREIGN KEY ("clinic_id", "recorded_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_recorder_tenant_fk"
  FOREIGN KEY ("clinic_id", "recorded_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_recorder_tenant_fk"
  FOREIGN KEY ("clinic_id", "recorded_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_encounter_tenant_fk"
  FOREIGN KEY ("clinic_id", "encounter_id") REFERENCES "encounters" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_recorder_tenant_fk"
  FOREIGN KEY ("clinic_id", "recorded_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_encounter_tenant_fk"
  FOREIGN KEY ("clinic_id", "encounter_id") REFERENCES "encounters" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_service_tenant_fk"
  FOREIGN KEY ("clinic_id", "service_id") REFERENCES "services" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "procedure_status_history" ADD CONSTRAINT "procedure_status_history_actor_tenant_fk"
  FOREIGN KEY ("clinic_id", "changed_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_provider_tenant_fk"
  FOREIGN KEY ("clinic_id", "provider_id") REFERENCES "providers" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_supersedes_tenant_fk"
  FOREIGN KEY ("clinic_id", "supersedes_plan_id") REFERENCES "treatment_plans" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_service_tenant_fk"
  FOREIGN KEY ("clinic_id", "service_id") REFERENCES "services" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "xray_studies" ADD CONSTRAINT "xray_studies_ordering_provider_tenant_fk"
  FOREIGN KEY ("clinic_id", "ordered_by_provider_id") REFERENCES "providers" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_requester_tenant_fk"
  FOREIGN KEY ("clinic_id", "requested_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "anesthesia_assessments" ADD CONSTRAINT "anesthesia_assessments_encounter_tenant_fk"
  FOREIGN KEY ("clinic_id", "encounter_id") REFERENCES "encounters" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "anesthesia_assessments" ADD CONSTRAINT "anesthesia_assessments_approver_tenant_fk"
  FOREIGN KEY ("clinic_id", "approved_by_provider_id") REFERENCES "providers" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "anesthesia_assessments" ADD CONSTRAINT "anesthesia_assessments_supersedes_tenant_fk"
  FOREIGN KEY ("clinic_id", "supersedes_assessment_id") REFERENCES "anesthesia_assessments" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_creator_tenant_fk"
  FOREIGN KEY ("clinic_id", "created_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorder_tenant_fk"
  FOREIGN KEY ("clinic_id", "recorded_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_recorder_tenant_fk"
  FOREIGN KEY ("clinic_id", "recorded_by_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_membership_id_memberships_id_fk";--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_tenant_fk"
  FOREIGN KEY ("clinic_id", "actor_membership_id") REFERENCES "memberships" ("clinic_id", "id") ON DELETE RESTRICT;--> statement-breakpoint

-- Active appointments cannot double-book a provider, operatory, or patient.
-- Cancelled and no-show entries remain historical but no longer reserve time.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_provider_no_overlap"
  EXCLUDE USING gist (
    "clinic_id" WITH =,
    "provider_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("provider_id" IS NOT NULL AND "status" NOT IN ('cancelled', 'no_show'))
  DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_operatory_no_overlap"
  EXCLUDE USING gist (
    "clinic_id" WITH =,
    "operatory_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("operatory_id" IS NOT NULL AND "status" NOT IN ('cancelled', 'no_show'))
  DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_no_overlap"
  EXCLUDE USING gist (
    "clinic_id" WITH =,
    "patient_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" NOT IN ('cancelled', 'no_show'))
  DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_provider_no_overlap"
  EXCLUDE USING gist (
    "clinic_id" WITH =,
    "provider_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("provider_id" IS NOT NULL)
  DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_operatory_no_overlap"
  EXCLUDE USING gist (
    "clinic_id" WITH =,
    "operatory_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("operatory_id" IS NOT NULL)
  DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_check_appointment_against_blocks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'no_show') THEN
    RETURN NEW;
  END IF;

  IF NEW.provider_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('provider:' || NEW.clinic_id::text || ':' || NEW.provider_id::text, 0));
  END IF;
  IF NEW.operatory_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('operatory:' || NEW.clinic_id::text || ':' || NEW.operatory_id::text, 0));
  END IF;

  IF EXISTS (
    SELECT 1 FROM schedule_blocks b
    WHERE b.clinic_id = NEW.clinic_id
      AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
      AND ((NEW.provider_id IS NOT NULL AND b.provider_id = NEW.provider_id)
        OR (NEW.operatory_id IS NOT NULL AND b.operatory_id = NEW.operatory_id))
  ) THEN
    RAISE EXCEPTION 'appointment conflicts with a schedule block' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_check_block_against_appointments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('provider:' || NEW.clinic_id::text || ':' || NEW.provider_id::text, 0));
  END IF;
  IF NEW.operatory_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('operatory:' || NEW.clinic_id::text || ':' || NEW.operatory_id::text, 0));
  END IF;

  IF EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.clinic_id = NEW.clinic_id
      AND a.status NOT IN ('cancelled', 'no_show')
      AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
      AND ((NEW.provider_id IS NOT NULL AND a.provider_id = NEW.provider_id)
        OR (NEW.operatory_id IS NOT NULL AND a.operatory_id = NEW.operatory_id))
  ) THEN
    RAISE EXCEPTION 'schedule block conflicts with an appointment' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "appointments_block_collision_trg"
  BEFORE INSERT OR UPDATE OF "clinic_id", "provider_id", "operatory_id", "starts_at", "ends_at", "status"
  ON "appointments" FOR EACH ROW EXECUTE FUNCTION dentalai_check_appointment_against_blocks();--> statement-breakpoint
CREATE TRIGGER "schedule_blocks_appointment_collision_trg"
  BEFORE INSERT OR UPDATE OF "clinic_id", "provider_id", "operatory_id", "starts_at", "ends_at"
  ON "schedule_blocks" FOR EACH ROW EXECUTE FUNCTION dentalai_check_block_against_appointments();--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_reject_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;--> statement-breakpoint

CREATE TRIGGER "audit_events_append_only_trg"
  BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint
CREATE TRIGGER "appointment_status_history_append_only_trg"
  BEFORE UPDATE OR DELETE ON "appointment_status_history" FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint
CREATE TRIGGER "procedure_status_history_append_only_trg"
  BEFORE UPDATE OR DELETE ON "procedure_status_history" FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint
CREATE TRIGGER "ai_analysis_reviews_append_only_trg"
  BEFORE UPDATE OR DELETE ON "ai_analysis_reviews" FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_protect_clinical_note_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical_notes are versioned and cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'draft'
     AND (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') THEN
    RAISE EXCEPTION 'signed clinical note content is immutable; create an amended version' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'draft' AND OLD.is_current = false AND NEW.is_current = true THEN
    RAISE EXCEPTION 'a superseded clinical note cannot become current again' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "clinical_notes_history_trg"
  BEFORE UPDATE OR DELETE ON "clinical_notes" FOR EACH ROW EXECUTE FUNCTION dentalai_protect_clinical_note_history();--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_protect_anesthesia_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'anesthesia assessments cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.approval_state IN ('approved', 'rejected', 'superseded') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'finalized anesthesia assessments are immutable; create a new version' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "anesthesia_assessments_history_trg"
  BEFORE UPDATE OR DELETE ON "anesthesia_assessments" FOR EACH ROW EXECUTE FUNCTION dentalai_protect_anesthesia_history();--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_record_appointment_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO appointment_status_history (
      clinic_id, appointment_id, from_status, to_status, reason, changed_by_membership_id, occurred_at
    ) VALUES (
      NEW.clinic_id,
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status,
      CASE WHEN NEW.status IN ('cancelled', 'no_show') THEN NEW.cancellation_reason ELSE NULL END,
      CASE WHEN NEW.status IN ('cancelled', 'no_show') THEN NEW.cancelled_by_membership_id ELSE NEW.created_by_membership_id END,
      clock_timestamp()
    );
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "appointments_status_history_trg"
  AFTER INSERT OR UPDATE OF "status" ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION dentalai_record_appointment_status();--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_enforce_refund_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payment_amount bigint;
  refunded_amount bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || NEW.clinic_id::text || ':' || NEW.payment_id::text, 0));
  SELECT amount_minor INTO payment_amount
    FROM payments
    WHERE clinic_id = NEW.clinic_id AND id = NEW.payment_id;

  SELECT COALESCE(sum(amount_minor), 0) INTO refunded_amount
    FROM refunds
    WHERE clinic_id = NEW.clinic_id
      AND payment_id = NEW.payment_id
      AND status IN ('pending', 'succeeded')
      AND id <> NEW.id;

  IF NEW.status IN ('pending', 'succeeded') AND refunded_amount + NEW.amount_minor > payment_amount THEN
    RAISE EXCEPTION 'refund total exceeds payment amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "refunds_limit_trg"
  BEFORE INSERT OR UPDATE OF "clinic_id", "payment_id", "status", "amount_minor"
  ON "refunds" FOR EACH ROW EXECUTE FUNCTION dentalai_enforce_refund_limit();
