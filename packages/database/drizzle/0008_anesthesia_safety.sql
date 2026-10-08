-- Preserve legacy assessments unchanged; fail closed for the new unapproved rule set.
CREATE UNIQUE INDEX anesthesia_structure_patient_version_uidx
 ON anesthesia_assessments(clinic_id,patient_id,version)
 WHERE rule_set_version='anesthesia-structure-v1';
--> statement-breakpoint
CREATE FUNCTION guard_anesthesia_structure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND OLD.rule_set_version='anesthesia-structure-v1' THEN
   RAISE EXCEPTION 'anesthesia history is immutable; create a new assessment' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND NEW.rule_set_version='anesthesia-structure-v1' THEN
   RAISE EXCEPTION 'cannot replace a historical assessment with a new engine assessment' USING ERRCODE='55000';
 END IF;
 IF NEW.rule_set_version='anesthesia-structure-v1' THEN
   IF NEW.approval_state <> 'draft' OR NEW.approved_at IS NOT NULL OR NEW.approved_by_provider_id IS NOT NULL
     OR NEW.modeled_output IS NULL
     OR NEW.modeled_output->>'recommendationEnabled' IS DISTINCT FROM 'false'
     OR NEW.modeled_output->>'outcome' NOT IN ('insufficient_data','do_not_calculate')
     OR NEW.modeled_output->>'outcome' IS NULL
     OR NEW.modeled_output->>'ruleSetVersion' IS DISTINCT FROM NEW.rule_set_version
     OR NEW.modeled_output->>'formularyVersion' IS DISTINCT FROM 'unapproved-empty-v1'
     OR NEW.modeled_output->'referenceSetVersion' IS DISTINCT FROM 'null'::jsonb
     OR NEW.modeled_output->>'approvalState' IS DISTINCT FROM 'draft'
     OR NEW.modeled_output->'maximumMg' IS DISTINCT FROM 'null'::jsonb
     OR NEW.modeled_output->'proposedMg' IS DISTINCT FROM 'null'::jsonb THEN
     RAISE EXCEPTION 'unapproved anesthesia rules cannot produce or approve recommendations' USING ERRCODE='23514';
   END IF;
   IF NEW.supersedes_assessment_id IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM anesthesia_assessments a WHERE a.id=NEW.supersedes_assessment_id
     AND a.clinic_id=NEW.clinic_id AND a.patient_id=NEW.patient_id
     AND a.rule_set_version=NEW.rule_set_version AND a.version=NEW.version-1) THEN
     RAISE EXCEPTION 'invalid anesthesia predecessor' USING ERRCODE='23514';
   END IF;
   IF (NEW.version=1) IS DISTINCT FROM (NEW.supersedes_assessment_id IS NULL) THEN
     RAISE EXCEPTION 'anesthesia version requires predecessor' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER anesthesia_structure_guard BEFORE INSERT OR UPDATE OR DELETE
 ON anesthesia_assessments FOR EACH ROW EXECUTE FUNCTION guard_anesthesia_structure();
