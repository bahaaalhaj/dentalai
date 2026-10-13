-- Additive: retained legacy analysis JSON is never rewritten. New responses are compact v2.
ALTER TABLE image_inference_runs DROP CONSTRAINT image_inference_runs_check;
ALTER TABLE image_inference_runs ADD CONSTRAINT image_inference_runs_result_check CHECK (
 (status='running' AND result IS NULL AND error_code IS NULL AND completed_at IS NULL) OR
 (status='failed' AND result IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL) OR
 (status='succeeded' AND result IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL AND jsonb_typeof(result)='object' AND (
  (NOT result ? 'responseVersion' AND result ?& ARRAY['modelName','modelVersion','artifactSha256','classMap','confidenceThreshold','iouThreshold','latencyMs','rawPredictions','rawDetections','detections','postprocessingVersion','imageSha256']) OR
  (result->>'responseVersion'='detections-v2' AND result ?& ARRAY['modelName','modelVersion','artifactSha256','classMap','confidenceThreshold','iouThreshold','latencyMs','postprocessingVersion','imageSha256','detectionCount']
   AND NOT result ?| ARRAY['rawPredictions','rawDetections','detections']
   AND jsonb_typeof(result->'classMap')='array' AND jsonb_array_length(result->'classMap') BETWEEN 1 AND 100
   AND jsonb_typeof(result->'detectionCount')='number'
   AND (result->>'detectionCount')::integer BETWEEN 0 AND 1000
   AND octet_length(result::text)<=65536)
 )));
--> statement-breakpoint
ALTER TABLE image_inference_runs ADD COLUMN lease_expires_at timestamptz NOT NULL DEFAULT (now()+interval '2 minutes');
CREATE INDEX image_runs_recovery_idx ON image_inference_runs(clinic_id,lease_expires_at) WHERE status='running';
CREATE FUNCTION dentalai_compact_detection_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_record image_inference_runs%ROWTYPE;
BEGIN
 SELECT * INTO row_record FROM image_inference_runs WHERE clinic_id=NEW.clinic_id AND id=NEW.id;
 IF row_record.status='succeeded' AND row_record.result->>'responseVersion'='detections-v2' AND
    (SELECT count(*) FROM image_model_detections WHERE clinic_id=NEW.clinic_id AND run_id=NEW.id)<>(row_record.result->>'detectionCount')::integer THEN
  RAISE EXCEPTION 'Compact result requires complete normalized detections' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER compact_detection_count AFTER INSERT OR UPDATE ON image_inference_runs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentalai_compact_detection_count();
CREATE FUNCTION dentalai_detection_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_record record;
BEGIN
 SELECT r.status,r.result,r.xmin::text::bigint AS version_transaction,v.width AS image_width,v.height AS image_height INTO run_record
 FROM image_inference_runs r JOIN clinical_image_versions v ON v.clinic_id=r.clinic_id AND v.id=r.image_id
 WHERE r.clinic_id=NEW.clinic_id AND r.id=NEW.run_id FOR SHARE OF r,v;
 IF run_record.status IS DISTINCT FROM 'succeeded' OR
    run_record.version_transaction <> (pg_current_xact_id()::text::bigint % 4294967296) THEN
  RAISE EXCEPTION 'Detections must be published atomically with the successful run' USING ERRCODE='23514'; END IF;
 IF NEW.ordinal NOT BETWEEN 0 AND 999 OR NEW.class_id<0 OR
    NEW.class_id>=jsonb_array_length(run_record.result->'classMap') OR
    NEW.class_name IS DISTINCT FROM (run_record.result->'classMap'->>NEW.class_id) OR
    NOT (NEW.score BETWEEN 0 AND 1 AND NEW.x>=0 AND NEW.y>=0 AND NEW.width>0 AND NEW.height>0
      AND NEW.x+NEW.width<=run_record.image_width AND NEW.y+NEW.height<=run_record.image_height) THEN
  RAISE EXCEPTION 'Invalid normalized model detection' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER detection_insert_guard BEFORE INSERT ON image_model_detections
 FOR EACH ROW EXECUTE FUNCTION dentalai_detection_insert_guard();
--> statement-breakpoint
CREATE TABLE imaging_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('upload','analysis')),
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL, request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 image_id uuid, run_id uuid, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), lease_expires_at timestamptz NOT NULL DEFAULT (now()+interval '2 minutes'),
 UNIQUE(clinic_id,request_key), UNIQUE(clinic_id,id),
 FOREIGN KEY(clinic_id,patient_id) REFERENCES patients(clinic_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,image_id) REFERENCES clinical_image_versions(clinic_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,run_id) REFERENCES image_inference_runs(clinic_id,id) ON DELETE RESTRICT
);
CREATE INDEX imaging_operations_recovery_idx ON imaging_operations(clinic_id,lease_expires_at) WHERE state='pending';
