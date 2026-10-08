-- Reviewed Phase 7: retain appointments, serialize closures/bookings, and audit transitions.
ALTER TABLE appointments ADD COLUMN revision integer NOT NULL DEFAULT 0 CONSTRAINT appointments_revision_chk CHECK(revision>=0),
 ADD COLUMN last_changed_by_membership_id uuid,
 ADD CONSTRAINT appointments_last_actor_tenant_fk FOREIGN KEY(clinic_id,last_changed_by_membership_id)
 REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE TABLE clinic_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 location_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 reason text NOT NULL CONSTRAINT clinic_closures_reason_chk CHECK(length(trim(reason))>0), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT clinic_closures_location_tenant_fk FOREIGN KEY(clinic_id,location_id) REFERENCES locations(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT clinic_closures_range_chk CHECK(starts_at<ends_at)
);--> statement-breakpoint
CREATE INDEX clinic_closures_time_idx ON clinic_closures(clinic_id,starts_at,ends_at) WHERE active;--> statement-breakpoint
CREATE TABLE appointment_slot_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, token_hash text NOT NULL CONSTRAINT appointment_slot_offers_token_hash_unique UNIQUE,
 location_id uuid NOT NULL, provider_id uuid NOT NULL, operatory_id uuid NOT NULL, appointment_type_id uuid NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, timezone text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 CONSTRAINT appointment_slot_offers_location_tenant_fk FOREIGN KEY(clinic_id,location_id) REFERENCES locations(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT appointment_slot_offers_provider_tenant_fk FOREIGN KEY(clinic_id,provider_id) REFERENCES providers(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT appointment_slot_offers_operatory_location_tenant_fk FOREIGN KEY(clinic_id,operatory_id,location_id) REFERENCES operatories(clinic_id,id,location_id) ON DELETE RESTRICT,
 CONSTRAINT appointment_slot_offers_type_tenant_fk FOREIGN KEY(clinic_id,appointment_type_id) REFERENCES appointment_types(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT appointment_slot_offers_range_chk CHECK(starts_at<ends_at), CONSTRAINT appointment_slot_offers_timezone_chk CHECK(dentalai_timezone_exists(timezone))
);--> statement-breakpoint
CREATE INDEX appointment_slot_offers_expiry_idx ON appointment_slot_offers(expires_at);--> statement-breakpoint
CREATE INDEX appointment_slot_offers_user_idx ON appointment_slot_offers(clinic_id,user_id);--> statement-breakpoint
CREATE OR REPLACE FUNCTION dentalai_appointment_closure_collision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('scheduling:'||NEW.clinic_id::text,0));
 IF NEW.status NOT IN ('cancelled','no_show') AND EXISTS (
  SELECT 1 FROM clinic_closures c WHERE c.clinic_id=NEW.clinic_id AND c.active
  AND (c.location_id IS NULL OR c.location_id=NEW.location_id)
  AND tstzrange(c.starts_at,c.ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')
 ) THEN RAISE EXCEPTION 'appointment conflicts with closure' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER appointments_00_closure_collision_trg BEFORE INSERT OR UPDATE ON appointments
 FOR EACH ROW EXECUTE FUNCTION dentalai_appointment_closure_collision();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dentalai_closure_appointment_collision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('scheduling:'||NEW.clinic_id::text,0));
 IF NEW.active AND EXISTS (
  SELECT 1 FROM appointments a WHERE a.clinic_id=NEW.clinic_id AND a.status NOT IN ('cancelled','no_show')
  AND (NEW.location_id IS NULL OR a.location_id=NEW.location_id)
  AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')
 ) THEN RAISE EXCEPTION 'closure conflicts with appointment' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER clinic_closures_collision_trg BEFORE INSERT OR UPDATE ON clinic_closures
 FOR EACH ROW EXECUTE FUNCTION dentalai_closure_appointment_collision();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dentalai_guard_appointment_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE moved boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'appointments cannot be deleted; retain history' USING ERRCODE='55000'; END IF;
 moved := (NEW.starts_at,NEW.ends_at,NEW.timezone,NEW.location_id,NEW.provider_id,NEW.operatory_id,NEW.appointment_type_id)
  IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.timezone,OLD.location_id,OLD.provider_id,OLD.operatory_id,OLD.appointment_type_id);
 IF NEW.clinic_id<>OLD.clinic_id OR NEW.patient_id<>OLD.patient_id THEN
  RAISE EXCEPTION 'appointment identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('completed','cancelled','no_show') AND (moved OR NEW.status<>OLD.status) THEN
  RAISE EXCEPTION 'terminal appointment is immutable' USING ERRCODE='23514'; END IF;
 IF moved AND (OLD.status NOT IN ('scheduled','confirmed') OR OLD.starts_at<=clock_timestamp()) THEN
  RAISE EXCEPTION 'only upcoming appointments can be rescheduled' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT (
  (OLD.status='scheduled' AND NEW.status IN ('confirmed','cancelled','no_show')) OR
  (OLD.status='confirmed' AND NEW.status IN ('checked_in','completed','cancelled','no_show')) OR
  (OLD.status='checked_in' AND NEW.status IN ('in_progress','completed','cancelled')) OR
  (OLD.status='in_progress' AND NEW.status='completed') OR
  (OLD.status='confirmed' AND NEW.status='scheduled' AND moved)
 ) THEN RAISE EXCEPTION 'invalid appointment transition' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NEW.status='completed' AND NEW.ends_at>clock_timestamp() THEN
  RAISE EXCEPTION 'cannot complete a future appointment' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NEW.status IN ('no_show','in_progress') AND NEW.starts_at>clock_timestamp() THEN
  RAISE EXCEPTION 'appointment has not started' USING ERRCODE='23514'; END IF;
 NEW.revision:=OLD.revision+1; NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER appointments_history_guard_trg BEFORE UPDATE OR DELETE ON appointments
 FOR EACH ROW EXECUTE FUNCTION dentalai_guard_appointment_history();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dentalai_record_appointment_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO appointment_status_history(clinic_id,appointment_id,from_status,to_status,reason,changed_by_membership_id,occurred_at)
  VALUES(NEW.clinic_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,
   CASE WHEN NEW.status IN ('cancelled','no_show') THEN NEW.cancellation_reason END,
   COALESCE(NEW.last_changed_by_membership_id,NEW.created_by_membership_id),clock_timestamp());
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dentalai_audit_appointment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; next_value jsonb; event_action text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.status,NEW.starts_at,NEW.ends_at,NEW.timezone,NEW.provider_id,NEW.operatory_id,NEW.location_id,NEW.appointment_type_id)
  IS NOT DISTINCT FROM (OLD.status,OLD.starts_at,OLD.ends_at,OLD.timezone,OLD.provider_id,OLD.operatory_id,OLD.location_id,OLD.appointment_type_id) THEN RETURN NEW; END IF;
 previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE jsonb_build_object('status',OLD.status,'startsAt',OLD.starts_at,'endsAt',OLD.ends_at,'timezone',OLD.timezone,'providerId',OLD.provider_id,'operatoryId',OLD.operatory_id,'locationId',OLD.location_id,'appointmentTypeId',OLD.appointment_type_id) END;
 next_value:=jsonb_build_object('status',NEW.status,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'timezone',NEW.timezone,'providerId',NEW.provider_id,'operatoryId',NEW.operatory_id,'locationId',NEW.location_id,'appointmentTypeId',NEW.appointment_type_id);
 event_action:=CASE WHEN TG_OP='INSERT' THEN 'appointment.booked' WHEN (NEW.starts_at,NEW.ends_at,NEW.timezone,NEW.provider_id,NEW.operatory_id,NEW.location_id,NEW.appointment_type_id) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.timezone,OLD.provider_id,OLD.operatory_id,OLD.location_id,OLD.appointment_type_id) THEN 'appointment.rescheduled' ELSE 'appointment.'||NEW.status::text END;
 INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id,data)
 VALUES(NEW.clinic_id,(SELECT user_id FROM memberships WHERE id=COALESCE(NEW.last_changed_by_membership_id,NEW.created_by_membership_id) AND clinic_id=NEW.clinic_id),
 COALESCE(NEW.last_changed_by_membership_id,NEW.created_by_membership_id),event_action,'appointment',NEW.id,
 NULLIF(current_setting('dentalai.request_id',true),''),jsonb_build_object('before',previous,'after',next_value));
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER appointments_audit_transition_trg AFTER INSERT OR UPDATE ON appointments
 FOR EACH ROW EXECUTE FUNCTION dentalai_audit_appointment_transition();
