-- Additive senior-review repair. Do not edit previously applied migrations or delete records.
-- Existing inconsistent patient links make this migration fail and roll back; reconcile them manually.
CREATE UNIQUE INDEX appointments_clinic_id_patient_uidx ON appointments(clinic_id,id,patient_id);--> statement-breakpoint
CREATE UNIQUE INDEX encounters_clinic_id_patient_uidx ON encounters(clinic_id,id,patient_id);--> statement-breakpoint
CREATE UNIQUE INDEX xray_studies_clinic_id_patient_uidx ON xray_studies(clinic_id,id,patient_id);--> statement-breakpoint
ALTER TABLE encounters ADD CONSTRAINT encounters_appointment_patient_fk
 FOREIGN KEY(clinic_id,appointment_id,patient_id) REFERENCES appointments(clinic_id,id,patient_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE clinical_notes ADD CONSTRAINT clinical_notes_encounter_patient_fk
 FOREIGN KEY(clinic_id,encounter_id,patient_id) REFERENCES encounters(clinic_id,id,patient_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE odontogram_findings ADD CONSTRAINT odontogram_findings_encounter_patient_fk
 FOREIGN KEY(clinic_id,encounter_id,patient_id) REFERENCES encounters(clinic_id,id,patient_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE procedures ADD CONSTRAINT procedures_encounter_patient_fk
 FOREIGN KEY(clinic_id,encounter_id,patient_id) REFERENCES encounters(clinic_id,id,patient_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE xray_studies ADD CONSTRAINT xray_studies_encounter_patient_fk
 FOREIGN KEY(clinic_id,encounter_id,patient_id) REFERENCES encounters(clinic_id,id,patient_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE anesthesia_assessments ADD CONSTRAINT anesthesia_assessments_encounter_patient_fk
 FOREIGN KEY(clinic_id,encounter_id,patient_id) REFERENCES encounters(clinic_id,id,patient_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE ai_analysis_runs ADD CONSTRAINT ai_analysis_runs_study_patient_fk
 FOREIGN KEY(clinic_id,xray_study_id,patient_id) REFERENCES xray_studies(clinic_id,id,patient_id) ON DELETE RESTRICT;--> statement-breakpoint

CREATE OR REPLACE FUNCTION dentalai_guard_appointment_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'appointment creation provenance is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('completed','cancelled','no_show') AND
  (NEW.cancellation_reason,NEW.cancelled_at,NEW.cancelled_by_membership_id)
  IS DISTINCT FROM (OLD.cancellation_reason,OLD.cancelled_at,OLD.cancelled_by_membership_id) THEN
  RAISE EXCEPTION 'terminal appointment cancellation provenance is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER appointments_provenance_guard_trg BEFORE UPDATE ON appointments
 FOR EACH ROW EXECUTE FUNCTION dentalai_guard_appointment_provenance();--> statement-breakpoint

-- Include cancellation/no-show reason in the append-only audit used by the history endpoint.
CREATE OR REPLACE FUNCTION dentalai_audit_appointment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; next_value jsonb; event_action text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.status,NEW.starts_at,NEW.ends_at,NEW.timezone,NEW.provider_id,NEW.operatory_id,NEW.location_id,NEW.appointment_type_id,NEW.cancellation_reason)
  IS NOT DISTINCT FROM (OLD.status,OLD.starts_at,OLD.ends_at,OLD.timezone,OLD.provider_id,OLD.operatory_id,OLD.location_id,OLD.appointment_type_id,OLD.cancellation_reason) THEN RETURN NEW; END IF;
 previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE jsonb_build_object('status',OLD.status,'startsAt',OLD.starts_at,'endsAt',OLD.ends_at,'timezone',OLD.timezone,'providerId',OLD.provider_id,'operatoryId',OLD.operatory_id,'locationId',OLD.location_id,'appointmentTypeId',OLD.appointment_type_id,'reason',OLD.cancellation_reason) END;
 next_value:=jsonb_build_object('status',NEW.status,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'timezone',NEW.timezone,'providerId',NEW.provider_id,'operatoryId',NEW.operatory_id,'locationId',NEW.location_id,'appointmentTypeId',NEW.appointment_type_id,'reason',NEW.cancellation_reason);
 event_action:=CASE WHEN TG_OP='INSERT' THEN 'appointment.booked' WHEN (NEW.starts_at,NEW.ends_at,NEW.timezone,NEW.provider_id,NEW.operatory_id,NEW.location_id,NEW.appointment_type_id) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.timezone,OLD.provider_id,OLD.operatory_id,OLD.location_id,OLD.appointment_type_id) THEN 'appointment.rescheduled' ELSE 'appointment.'||NEW.status::text END;
 INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id,data)
 VALUES(NEW.clinic_id,(SELECT user_id FROM memberships WHERE id=COALESCE(NEW.last_changed_by_membership_id,NEW.created_by_membership_id) AND clinic_id=NEW.clinic_id),
 COALESCE(NEW.last_changed_by_membership_id,NEW.created_by_membership_id),event_action,'appointment',NEW.id,
 NULLIF(current_setting('dentalai.request_id',true),''),jsonb_build_object('before',previous,'after',next_value));
 RETURN NEW;
END $$;
