-- Phase 8: additive, normalized content plus immutable revision/approval ledgers.
-- Legacy rows remain untouched and are NOT automatically approved or exposed to the portal.
CREATE TABLE clinical_revisions (
 id uuid PRIMARY KEY, clinic_id uuid NOT NULL CONSTRAINT clinical_revisions_clinic_id_clinics_id_fk REFERENCES clinics(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL, encounter_id uuid NOT NULL, kind text NOT NULL,
 group_id uuid NOT NULL, version integer NOT NULL, supersedes_id uuid,
 author_membership_id uuid NOT NULL, reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT clinical_revisions_kind_chk CHECK(kind IN ('demographics','note','alert','allergy','medication','finding','procedure','plan')),
 CONSTRAINT clinical_revisions_version_chk CHECK(version > 0),
 CONSTRAINT clinical_revisions_reason_chk CHECK(length(trim(reason)) > 0),
 CONSTRAINT clinical_revisions_patient_fk FOREIGN KEY(clinic_id,patient_id) REFERENCES patients(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT clinical_revisions_encounter_fk FOREIGN KEY(clinic_id,encounter_id,patient_id) REFERENCES encounters(clinic_id,id,patient_id) ON DELETE RESTRICT,
 CONSTRAINT clinical_revisions_author_fk FOREIGN KEY(clinic_id,author_membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX clinical_revisions_tenant_identity_uidx ON clinical_revisions(clinic_id,id,patient_id,group_id,kind);--> statement-breakpoint
CREATE UNIQUE INDEX clinical_revisions_clinic_id_uidx ON clinical_revisions(clinic_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX clinical_revisions_group_version_uidx ON clinical_revisions(clinic_id,group_id,version);--> statement-breakpoint
CREATE UNIQUE INDEX clinical_revisions_one_successor_uidx ON clinical_revisions(clinic_id,supersedes_id);--> statement-breakpoint
CREATE INDEX clinical_revisions_patient_timeline_idx ON clinical_revisions(clinic_id,patient_id,recorded_at);--> statement-breakpoint
ALTER TABLE clinical_revisions ADD CONSTRAINT clinical_revisions_predecessor_fk
 FOREIGN KEY(clinic_id,supersedes_id,patient_id,group_id,kind)
 REFERENCES clinical_revisions(clinic_id,id,patient_id,group_id,kind) ON DELETE RESTRICT;--> statement-breakpoint
CREATE TABLE clinical_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL CONSTRAINT clinical_approvals_clinic_id_clinics_id_fk REFERENCES clinics(id) ON DELETE RESTRICT,
 revision_id uuid NOT NULL, decision text NOT NULL, reviewer_membership_id uuid NOT NULL,
 reason text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT clinical_approvals_decision_chk CHECK(decision IN ('approved','rejected')),
 CONSTRAINT clinical_approvals_reason_chk CHECK(length(trim(reason)) > 0),
 CONSTRAINT clinical_approvals_revision_fk FOREIGN KEY(clinic_id,revision_id) REFERENCES clinical_revisions(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT clinical_approvals_reviewer_fk FOREIGN KEY(clinic_id,reviewer_membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX clinical_approvals_once_uidx ON clinical_approvals(clinic_id,revision_id);--> statement-breakpoint
CREATE TABLE clinical_demographics (
 id uuid PRIMARY KEY, clinic_id uuid NOT NULL CONSTRAINT clinical_demographics_clinic_id_clinics_id_fk REFERENCES clinics(id) ON DELETE RESTRICT,
 given_name text NOT NULL, family_name text NOT NULL, preferred_name text, date_of_birth date, phone text, email text,
 CONSTRAINT clinical_demographics_names_chk CHECK(length(trim(given_name)) > 0 AND length(trim(family_name)) > 0),
 CONSTRAINT clinical_demographics_birth_date_chk CHECK(date_of_birth IS NULL OR date_of_birth <= current_date),
 CONSTRAINT clinical_demographics_revision_fk FOREIGN KEY(clinic_id,id) REFERENCES clinical_revisions(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE TABLE clinical_encounter_provenance (
 encounter_id uuid PRIMARY KEY, clinic_id uuid NOT NULL CONSTRAINT clinical_encounter_provenance_clinic_id_clinics_id_fk REFERENCES clinics(id) ON DELETE RESTRICT,
 author_membership_id uuid NOT NULL, reason text NOT NULL CONSTRAINT clinical_encounter_provenance_reason_chk CHECK(length(trim(reason)) > 0),
 CONSTRAINT clinical_encounter_provenance_encounter_fk FOREIGN KEY(clinic_id,encounter_id) REFERENCES encounters(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT clinical_encounter_provenance_author_fk FOREIGN KEY(clinic_id,author_membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE TABLE treatment_plan_item_surfaces (
 clinic_id uuid NOT NULL CONSTRAINT treatment_plan_item_surfaces_clinic_id_clinics_id_fk REFERENCES clinics(id) ON DELETE RESTRICT, item_id uuid NOT NULL, surface_code text NOT NULL,
 CONSTRAINT treatment_plan_item_surfaces_clinic_id_item_id_surface_code_pk PRIMARY KEY(clinic_id,item_id,surface_code), CONSTRAINT treatment_plan_item_surfaces_code_chk CHECK(surface_code IN ('M','D','B','F','L','O','I')),
 CONSTRAINT treatment_plan_item_surfaces_item_fk FOREIGN KEY(clinic_id,item_id) REFERENCES treatment_plan_items(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE FUNCTION dentalai_clinical_revision_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior clinical_revisions;
BEGIN
 IF NEW.supersedes_id IS NULL THEN
  IF NEW.version <> 1 OR NEW.group_id <> NEW.id THEN RAISE EXCEPTION 'invalid revision root' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO prior FROM clinical_revisions WHERE clinic_id=NEW.clinic_id AND id=NEW.supersedes_id;
  IF prior.id IS NULL OR NEW.version <> prior.version+1 THEN RAISE EXCEPTION 'invalid revision successor' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER clinical_revision_chain_trg BEFORE INSERT ON clinical_revisions FOR EACH ROW EXECUTE FUNCTION dentalai_clinical_revision_chain();--> statement-breakpoint
CREATE TRIGGER clinical_revisions_immutable_trg BEFORE UPDATE OR DELETE ON clinical_revisions FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint
CREATE TRIGGER clinical_approvals_immutable_trg BEFORE UPDATE OR DELETE ON clinical_approvals FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint
CREATE TRIGGER clinical_encounter_provenance_immutable_trg BEFORE UPDATE OR DELETE ON clinical_encounter_provenance FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint

-- A normalized payload must exist in the SAME transaction, and match header ownership.
CREATE FUNCTION dentalai_clinical_payload_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; payload jsonb; surfaces text[]; item record;
BEGIN
 target := CASE NEW.kind WHEN 'demographics' THEN 'clinical_demographics' WHEN 'note' THEN 'clinical_notes'
 WHEN 'alert' THEN 'medical_alerts' WHEN 'allergy' THEN 'allergies' WHEN 'medication' THEN 'medications'
 WHEN 'finding' THEN 'odontogram_findings' WHEN 'procedure' THEN 'procedures' WHEN 'plan' THEN 'treatment_plans' END;
 EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE clinic_id=$1 AND id=$2',target) INTO payload USING NEW.clinic_id,NEW.id;
 IF payload IS NULL OR (payload ? 'patient_id' AND payload->>'patient_id' <> NEW.patient_id::text)
 OR (payload ? 'encounter_id' AND payload->>'encounter_id' IS DISTINCT FROM NEW.encounter_id::text) THEN
  RAISE EXCEPTION 'missing or mismatched clinical payload' USING ERRCODE='23514';
 END IF;
 IF (payload ? 'recorded_by_membership_id' AND payload->>'recorded_by_membership_id' <> NEW.author_membership_id::text)
 OR (payload ? 'authored_by_membership_id' AND payload->>'authored_by_membership_id' <> NEW.author_membership_id::text)
 OR (NEW.kind='note' AND (payload->>'note_group_id' <> NEW.group_id::text OR (payload->>'version')::int <> NEW.version)) THEN
  RAISE EXCEPTION 'clinical author or version mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('finding','procedure') THEN
  IF NEW.kind='finding' THEN SELECT array_agg(surface_code) INTO surfaces FROM odontogram_finding_surfaces WHERE clinic_id=NEW.clinic_id AND finding_id=NEW.id;
  ELSE SELECT array_agg(surface_code) INTO surfaces FROM procedure_surfaces WHERE clinic_id=NEW.clinic_id AND procedure_id=NEW.id; END IF;
  IF NOT dentalai_valid_tooth_surfaces(payload->>'tooth_code',COALESCE(surfaces,'{}')) THEN RAISE EXCEPTION 'invalid FDI tooth or surfaces' USING ERRCODE='23514'; END IF;
  IF payload->>'dentition' IS DISTINCT FROM (CASE WHEN left(payload->>'tooth_code',1) IN ('1','2','3','4') THEN 'permanent' WHEN payload->>'tooth_code' IS NULL THEN NULL ELSE 'primary' END) THEN
   RAISE EXCEPTION 'tooth and dentition mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.kind='finding' AND payload->>'finding_code'='missing' AND cardinality(COALESCE(surfaces,'{}'))>0 THEN RAISE EXCEPTION 'missing tooth has no surfaces' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind='plan' THEN
  IF NOT EXISTS(SELECT 1 FROM treatment_plan_items WHERE clinic_id=NEW.clinic_id AND treatment_plan_id=NEW.id) THEN RAISE EXCEPTION 'plan requires items' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT * FROM treatment_plan_items WHERE clinic_id=NEW.clinic_id AND treatment_plan_id=NEW.id LOOP
   SELECT array_agg(surface_code) INTO surfaces FROM treatment_plan_item_surfaces WHERE clinic_id=NEW.clinic_id AND item_id=item.id;
   IF NOT dentalai_valid_tooth_surfaces(item.tooth_code,COALESCE(surfaces,'{}')) THEN RAISE EXCEPTION 'invalid plan tooth surfaces' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.clinic_id=NEW.clinic_id AND a.entity_id=NEW.id
  AND a.actor_membership_id=NEW.author_membership_id AND a.action IN ('clinical.created','clinical.corrected')
  AND a.data->>'patientId'=NEW.patient_id::text AND a.data->>'reason'=NEW.reason AND a.data ? 'before' AND a.data ? 'after') THEN
  RAISE EXCEPTION 'clinical revision requires an atomic audit event' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION dentalai_valid_tooth_surfaces(tooth text,surfaces text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN tooth IS NULL THEN cardinality(surfaces)=0
 WHEN tooth !~ '^([1-4][1-8]|[5-8][1-5])$' THEN false
 ELSE NOT EXISTS(SELECT 1 FROM unnest(surfaces) s WHERE s NOT IN ('M','D','B','F','L','O','I')
 OR (substring(tooth,2,1)::int<=3 AND s IN ('O','B')) OR (substring(tooth,2,1)::int>3 AND s IN ('I','F'))) END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER clinical_payload_required_trg AFTER INSERT ON clinical_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentalai_clinical_payload_check();--> statement-breakpoint

-- Protect normalized content and child rows, while retaining legacy rows unchanged.
CREATE FUNCTION dentalai_protect_workflow_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision uuid; tenant uuid; has_approval boolean;
BEGIN
 IF TG_TABLE_NAME IN ('odontogram_finding_surfaces','procedure_surfaces') THEN
  revision := COALESCE(to_jsonb(OLD)->>'finding_id',to_jsonb(OLD)->>'procedure_id',to_jsonb(NEW)->>'finding_id',to_jsonb(NEW)->>'procedure_id')::uuid;
 ELSIF TG_TABLE_NAME='treatment_plan_items' THEN revision:=COALESCE(to_jsonb(OLD)->>'treatment_plan_id',to_jsonb(NEW)->>'treatment_plan_id')::uuid;
 ELSIF TG_TABLE_NAME='treatment_plan_item_surfaces' THEN
  SELECT treatment_plan_id INTO revision FROM treatment_plan_items WHERE id=COALESCE(to_jsonb(OLD)->>'item_id',to_jsonb(NEW)->>'item_id')::uuid;
 ELSE revision:=COALESCE(to_jsonb(OLD)->>'id',to_jsonb(NEW)->>'id')::uuid; END IF;
 tenant:=COALESCE(to_jsonb(OLD)->>'clinic_id',to_jsonb(NEW)->>'clinic_id')::uuid;
 IF EXISTS(SELECT 1 FROM clinical_revisions WHERE clinic_id=tenant AND id=revision) THEN
  IF TG_TABLE_NAME NOT IN ('odontogram_finding_surfaces','procedure_surfaces','treatment_plan_items','treatment_plan_item_surfaces') AND NOT EXISTS(
   SELECT 1 FROM clinical_revisions r WHERE r.clinic_id=tenant AND r.id=revision AND TG_TABLE_NAME=(CASE r.kind
    WHEN 'demographics' THEN 'clinical_demographics' WHEN 'note' THEN 'clinical_notes' WHEN 'alert' THEN 'medical_alerts'
    WHEN 'allergy' THEN 'allergies' WHEN 'medication' THEN 'medications' WHEN 'finding' THEN 'odontogram_findings'
    WHEN 'procedure' THEN 'procedures' WHEN 'plan' THEN 'treatment_plans' END)) THEN
   RAISE EXCEPTION 'clinical payload kind mismatch' USING ERRCODE='23514'; END IF;
  SELECT EXISTS(SELECT 1 FROM clinical_approvals WHERE clinic_id=tenant AND revision_id=revision) INTO has_approval;
  IF TG_OP<>'INSERT' OR has_approval THEN RAISE EXCEPTION 'clinical content is immutable; append a revision' USING ERRCODE='55000'; END IF;
  -- Child inserts are only allowed in the revision's original transaction.
  IF TG_TABLE_NAME IN ('odontogram_finding_surfaces','procedure_surfaces','treatment_plan_items','treatment_plan_item_surfaces')
   AND NOT EXISTS(SELECT 1 FROM clinical_revisions WHERE clinic_id=tenant AND id=revision AND xmin::text::bigint=(pg_current_xact_id()::text::numeric % 4294967296)::bigint) THEN
   RAISE EXCEPTION 'cannot extend committed clinical content' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['clinical_demographics','clinical_notes','medical_alerts','allergies','medications','odontogram_findings','procedures','treatment_plans','odontogram_finding_surfaces','procedure_surfaces','treatment_plan_items','treatment_plan_item_surfaces'] LOOP
  EXECUTE format('CREATE TRIGGER workflow_payload_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dentalai_protect_workflow_payload()',target);
 END LOOP;
END $$;--> statement-breakpoint
CREATE FUNCTION dentalai_protect_encounter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'encounter history cannot be deleted' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM clinical_encounter_provenance WHERE encounter_id=OLD.id) THEN
  IF OLD.status<>'open' OR (to_jsonb(NEW)-ARRAY['status','ended_at','signed_at','signed_by_membership_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','ended_at','signed_at','signed_by_membership_id'])
  OR NEW.status<>'signed' OR NEW.ended_at IS NULL THEN RAISE EXCEPTION 'invalid encounter transition' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER clinical_encounter_history_trg BEFORE UPDATE OR DELETE ON encounters FOR EACH ROW EXECUTE FUNCTION dentalai_protect_encounter();
--> statement-breakpoint
CREATE FUNCTION dentalai_clinical_approval_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM audit_events a JOIN clinical_revisions r ON r.clinic_id=a.clinic_id AND r.id=a.entity_id
  WHERE a.clinic_id=NEW.clinic_id AND a.entity_id=NEW.revision_id AND a.action='clinical.'||NEW.decision
  AND a.actor_membership_id=NEW.reviewer_membership_id AND a.data->>'reason'=NEW.reason
  AND a.data->>'patientId'=r.patient_id::text AND a.data ? 'before' AND a.data ? 'after') THEN
  RAISE EXCEPTION 'clinical approval requires an atomic audit event' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER clinical_approval_audit_trg AFTER INSERT ON clinical_approvals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentalai_clinical_approval_audit();
