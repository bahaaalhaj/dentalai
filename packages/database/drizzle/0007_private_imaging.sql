-- Additive migration. Existing studies, images and analyses are not rewritten or deleted.
CREATE UNIQUE INDEX files_clinic_id_patient_id_uidx ON files(clinic_id,id,patient_id);
--> statement-breakpoint
CREATE TABLE clinical_image_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL, study_id uuid NOT NULL, file_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 width integer NOT NULL CHECK(width BETWEEN 16 AND 8192), height integer NOT NULL CHECK(height BETWEEN 16 AND 8192),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(clinic_id,id), UNIQUE(clinic_id,study_id,version), UNIQUE(clinic_id,file_id),
 FOREIGN KEY(clinic_id,patient_id) REFERENCES patients(clinic_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,study_id,patient_id) REFERENCES xray_studies(clinic_id,id,patient_id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,file_id,patient_id) REFERENCES files(clinic_id,id,patient_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE image_inference_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 image_id uuid NOT NULL, requested_by_membership_id uuid NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),
 result jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(clinic_id,id),
 FOREIGN KEY(clinic_id,image_id) REFERENCES clinical_image_versions(clinic_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,requested_by_membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT,
 CHECK((status='running' AND result IS NULL AND error_code IS NULL AND completed_at IS NULL) OR
       (status='succeeded' AND result IS NOT NULL AND jsonb_typeof(result)='object' AND result ?& ARRAY['modelName','modelVersion','artifactSha256','classMap','confidenceThreshold','iouThreshold','latencyMs','rawPredictions','rawDetections','detections','postprocessingVersion','imageSha256'] AND error_code IS NULL AND completed_at IS NOT NULL) OR
       (status='failed' AND result IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL))
);
--> statement-breakpoint
-- Normalized detections are model observations, never automatically clinical truth.
CREATE TABLE image_model_detections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL, run_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0), class_id integer NOT NULL CHECK(class_id>=0), class_name text NOT NULL,
 score double precision NOT NULL CHECK(score BETWEEN 0 AND 1),
 x double precision NOT NULL CHECK(x BETWEEN 0 AND 8192), y double precision NOT NULL CHECK(y BETWEEN 0 AND 8192),
 width double precision NOT NULL CHECK(width>0 AND width<=8192), height double precision NOT NULL CHECK(height>0 AND height<=8192),
 UNIQUE(clinic_id,run_id,ordinal), FOREIGN KEY(clinic_id,run_id) REFERENCES image_inference_runs(clinic_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE image_clinician_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL, run_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('confirmed','rejected')), author_membership_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(clinic_id,run_id), FOREIGN KEY(clinic_id,run_id) REFERENCES image_inference_runs(clinic_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,author_membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX image_runs_history_idx ON image_inference_runs(clinic_id,image_id,created_at);
CREATE FUNCTION dentalai_image_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM image_inference_runs WHERE clinic_id=NEW.clinic_id AND id=NEW.run_id AND status='succeeded') OR
 NOT EXISTS(SELECT 1 FROM memberships m JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
 WHERE m.clinic_id=NEW.clinic_id AND m.id=NEW.author_membership_id AND m.status='active' AND r.key='dentist'
 AND EXISTS(SELECT 1 FROM providers p JOIN staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id WHERE p.clinic_id=m.clinic_id AND s.membership_id=m.id AND p.active AND s.active)) THEN
 RAISE EXCEPTION 'Only an active dentist can review a successful analysis' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER image_review_guard BEFORE INSERT ON image_clinician_reviews FOR EACH ROW EXECUTE FUNCTION dentalai_image_review_guard();
CREATE TRIGGER clinical_image_history_immutable BEFORE UPDATE OR DELETE ON clinical_image_versions FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();
CREATE TRIGGER image_review_immutable BEFORE UPDATE OR DELETE ON image_clinician_reviews FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();
CREATE TRIGGER image_detection_immutable BEFORE UPDATE OR DELETE ON image_model_detections FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();
CREATE FUNCTION dentalai_image_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'running' THEN RAISE EXCEPTION 'Image analysis history is immutable' USING ERRCODE='55000'; END IF;
 IF NEW.id<>OLD.id OR NEW.clinic_id<>OLD.clinic_id OR NEW.image_id<>OLD.image_id OR NEW.requested_by_membership_id<>OLD.requested_by_membership_id OR NEW.reason<>OLD.reason OR NEW.created_at<>OLD.created_at OR NEW.status='running' THEN
 RAISE EXCEPTION 'Only a terminal analysis transition is permitted' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER image_run_transition BEFORE UPDATE OR DELETE ON image_inference_runs FOR EACH ROW EXECUTE FUNCTION dentalai_image_run_guard();
-- Object registrations survive storage or DB failures; no image deletion API is provided.
CREATE FUNCTION dentalai_clinical_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM clinical_image_versions WHERE clinic_id=OLD.clinic_id AND file_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clinical object registration must be retained' USING ERRCODE='55000'; END IF;
  IF ROW(NEW.id,NEW.clinic_id,NEW.patient_id,NEW.storage_provider,NEW.bucket,NEW.object_key,NEW.original_filename,NEW.content_type,NEW.size_bytes,NEW.sha256,NEW.uploaded_by_membership_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.clinic_id,OLD.patient_id,OLD.storage_provider,OLD.bucket,OLD.object_key,OLD.original_filename,OLD.content_type,OLD.size_bytes,OLD.sha256,OLD.uploaded_by_membership_id,OLD.created_at) OR OLD.status<>'pending' OR NEW.status NOT IN ('available','quarantined') THEN
   RAISE EXCEPTION 'Clinical object provenance is immutable' USING ERRCODE='55000'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_file_registration BEFORE UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION dentalai_clinical_file_guard();
