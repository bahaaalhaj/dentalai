-- Phase 13: additive administration. No clinical/financial history is rewritten or deleted.
CREATE TABLE saas_plans (
 code text PRIMARY KEY, name text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 seats integer NOT NULL CHECK(seats>0), locations integer NOT NULL CHECK(locations>0),
 appointments_per_month integer NOT NULL CHECK(appointments_per_month>0),
 storage_bytes bigint NOT NULL CHECK(storage_bytes>0), public boolean NOT NULL DEFAULT true
);
INSERT INTO saas_plans(code,name,seats,locations,appointments_per_month,storage_bytes,public) VALUES
 ('starter','Starter administrative trial',25,2,100,52428800,true),
 ('team','Team administrative plan',50,10,1000,1073741824,true),
 ('legacy','Existing-clinic administrative grant',10000,10000,1000000,1099511627776,false);
--> statement-breakpoint
CREATE TABLE clinic_profiles (
 clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE RESTRICT,
 locale text NOT NULL DEFAULT 'en' CHECK(locale IN ('en','ar')),
 contact_email text, contact_phone text, brand_color text NOT NULL DEFAULT '#4f46e5' CHECK(brand_color ~ '^#[0-9a-fA-F]{6}$'),
 brand_mark text NOT NULL DEFAULT 'DA' CHECK(length(brand_mark) BETWEEN 1 AND 8),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clinic_subscriptions (
 clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE RESTRICT,
 plan_code text NOT NULL REFERENCES saas_plans(code) ON DELETE RESTRICT,
 provider text NOT NULL DEFAULT 'administrative-mock' CHECK(provider='administrative-mock'),
 state text NOT NULL CHECK(state IN ('trial','active','past_due','suspended','cancelled')),
 period_end timestamptz, grace_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
 requested_plan text REFERENCES saas_plans(code) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state NOT IN ('trial','past_due') OR period_end IS NOT NULL),
 CHECK(grace_end IS NULL OR (period_end IS NOT NULL AND grace_end>=period_end))
);
CREATE TABLE subscription_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT, action text NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>0),
 before_data jsonb, after_data jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_events_clinic_time_idx ON subscription_events(clinic_id,occurred_at);
CREATE FUNCTION reject_saas_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'administrative history is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER subscription_events_append_only BEFORE UPDATE OR DELETE ON subscription_events
 FOR EACH ROW EXECUTE FUNCTION reject_saas_history_mutation();
--> statement-breakpoint
CREATE TABLE clinic_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 requested_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(length(trim(reason))>0), manifest jsonb NOT NULL,
 UNIQUE(clinic_id,id), FOREIGN KEY(clinic_id,requested_by) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER clinic_exports_append_only BEFORE UPDATE OR DELETE ON clinic_exports
 FOR EACH ROW EXECUTE FUNCTION reject_saas_history_mutation();
CREATE TABLE clinic_offboarding (
 clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE RESTRICT,
 requested_by uuid NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>0),
 requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 export_id uuid, FOREIGN KEY(clinic_id,requested_by) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,export_id) REFERENCES clinic_exports(clinic_id,id) ON DELETE RESTRICT,
 CHECK(completed_at IS NULL OR export_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE notification_preferences (
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 membership_id uuid NOT NULL, operational_email boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(clinic_id,membership_id),
 FOREIGN KEY(clinic_id,membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT
);
ALTER TABLE invitations ADD CONSTRAINT invitations_clinic_id_id_key UNIQUE(clinic_id,id);
CREATE TABLE notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 recipient text NOT NULL, membership_id uuid, category text NOT NULL CHECK(category IN ('invitation','operational')),
 encrypted_message text NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','accepted','failed','skipped')),
 provider text, provider_reference text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz,
 invitation_id uuid, UNIQUE(clinic_id,id),
 FOREIGN KEY(clinic_id,membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(clinic_id,invitation_id) REFERENCES invitations(clinic_id,id) ON DELETE RESTRICT
);
CREATE INDEX notification_deliveries_clinic_time_idx ON notification_deliveries(clinic_id,created_at);
--> statement-breakpoint
-- Grants preserve the behavior of existing clinics, not payment evidence. New clinics get a finite trial.
INSERT INTO clinic_profiles(clinic_id) SELECT id FROM clinics;
INSERT INTO clinic_subscriptions(clinic_id,plan_code,state) SELECT id,'legacy','active' FROM clinics;
CREATE FUNCTION initialize_clinic_administration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO clinic_profiles(clinic_id) VALUES(NEW.id);
 INSERT INTO clinic_subscriptions(clinic_id,plan_code,state,period_end,grace_end)
 VALUES(NEW.id,'starter','trial',now()+interval '14 days',now()+interval '21 days');
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_clinic_administration AFTER INSERT ON clinics FOR EACH ROW EXECUTE FUNCTION initialize_clinic_administration();
--> statement-breakpoint
CREATE FUNCTION saas_lock(tenant uuid) RETURNS void LANGUAGE sql AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('saas:'||tenant::text,0))
$$;
CREATE FUNCTION saas_growth_allowed(tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT c.active AND
  ((s.state='active' AND (s.period_end IS NULL OR now()<coalesce(s.grace_end,s.period_end))) OR (s.state IN ('trial','past_due') AND now()<coalesce(s.grace_end,s.period_end))) AND
  (NOT s.cancel_at_period_end OR now()<s.period_end)
 FROM clinic_subscriptions s JOIN clinics c ON c.id=s.clinic_id WHERE s.clinic_id=tenant),false)
$$;
CREATE FUNCTION saas_usage(tenant uuid, resource text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE amount bigint;
BEGIN
 IF resource='seats' THEN
  SELECT count(DISTINCT m.id) INTO amount FROM memberships m JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
  JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id WHERE m.clinic_id=tenant AND m.status='active' AND r.key<>'patient';
  amount:=amount+(SELECT count(*) FROM invitations i WHERE i.clinic_id=tenant AND i.status='pending' AND i.expires_at>now()
   AND NOT EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id AND m.clinic_id=tenant AND m.status='active'
    JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
    WHERE lower(u.email)=lower(i.email) AND r.key<>'patient'));
 ELSIF resource='locations' THEN SELECT count(*) INTO amount FROM locations WHERE clinic_id=tenant AND active;
 ELSIF resource='appointments' THEN SELECT count(*) INTO amount FROM appointments WHERE clinic_id=tenant
  AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 ELSIF resource='storage' THEN SELECT coalesce(sum(size_bytes),0) INTO amount FROM files WHERE clinic_id=tenant;
 ELSE RAISE EXCEPTION 'unknown capacity resource'; END IF;
 RETURN amount;
END $$;
CREATE FUNCTION saas_check_capacity(tenant uuid, resource text, additional bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE maximum bigint;
BEGIN
 PERFORM saas_lock(tenant);
 IF NOT saas_growth_allowed(tenant) THEN RAISE EXCEPTION 'subscription growth unavailable' USING ERRCODE='P1302'; END IF;
 SELECT CASE resource WHEN 'seats' THEN p.seats WHEN 'locations' THEN p.locations
  WHEN 'appointments' THEN p.appointments_per_month WHEN 'storage' THEN p.storage_bytes END INTO maximum
 FROM saas_plans p JOIN clinic_subscriptions s ON s.plan_code=p.code WHERE s.clinic_id=tenant;
 IF maximum IS NULL OR saas_usage(tenant,resource)+additional>maximum THEN
  RAISE EXCEPTION 'plan capacity exceeded' USING ERRCODE='P1301';
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION enforce_saas_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource text; additional bigint:=1; staff_role boolean;
BEGIN
 -- Re-activation is growth; ordinary edits/transitions never consume a second unit.
 IF TG_TABLE_NAME='locations' THEN
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM locations WHERE clinic_id=NEW.clinic_id AND id=NEW.id) THEN RETURN NEW; END IF;
  IF NOT NEW.active OR (TG_OP='UPDATE' AND OLD.active) THEN RETURN NEW; END IF; resource:='locations';
 ELSIF TG_TABLE_NAME='appointments' THEN resource:='appointments';
 ELSIF TG_TABLE_NAME='files' THEN resource:='storage'; additional:=NEW.size_bytes;
 ELSIF TG_TABLE_NAME='invitations' THEN
  IF NEW.status<>'pending' OR NEW.expires_at<=now() THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='pending' AND OLD.expires_at>now() THEN RETURN NEW; END IF;
  resource:='seats';
  IF EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id AND m.clinic_id=NEW.clinic_id AND m.status='active'
   JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
   WHERE lower(u.email)=lower(NEW.email) AND r.key<>'patient') THEN additional:=0; END IF;
 ELSIF TG_TABLE_NAME='membership_roles' THEN
  SELECT key<>'patient' INTO staff_role FROM roles WHERE clinic_id=NEW.clinic_id AND id=NEW.role_id;
  IF NOT staff_role OR NOT EXISTS(SELECT 1 FROM memberships WHERE clinic_id=NEW.clinic_id AND id=NEW.membership_id AND status='active')
   OR EXISTS(SELECT 1 FROM membership_roles mr JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
   WHERE mr.clinic_id=NEW.clinic_id AND mr.membership_id=NEW.membership_id AND r.key<>'patient') THEN RETURN NEW; END IF;
  resource:='seats';
 ELSIF TG_TABLE_NAME='memberships' THEN
  IF NEW.status<>'active' OR OLD.status='active' OR NOT EXISTS(SELECT 1 FROM membership_roles mr JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id
   WHERE mr.clinic_id=NEW.clinic_id AND mr.membership_id=NEW.id AND r.key<>'patient') THEN RETURN NEW; END IF; resource:='seats';
 END IF;
 PERFORM saas_check_capacity(NEW.clinic_id,resource,additional);
 RETURN NEW;
END $$;
CREATE TRIGGER saas_locations_capacity BEFORE INSERT OR UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION enforce_saas_capacity();
CREATE TRIGGER saas_appointments_capacity BEFORE INSERT ON appointments FOR EACH ROW EXECUTE FUNCTION enforce_saas_capacity();
CREATE TRIGGER saas_files_capacity BEFORE INSERT ON files FOR EACH ROW EXECUTE FUNCTION enforce_saas_capacity();
CREATE TRIGGER saas_invitations_capacity BEFORE INSERT OR UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION enforce_saas_capacity();
CREATE TRIGGER saas_roles_capacity BEFORE INSERT ON membership_roles FOR EACH ROW EXECUTE FUNCTION enforce_saas_capacity();
CREATE TRIGGER saas_memberships_capacity BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION enforce_saas_capacity();
--> statement-breakpoint
CREATE FUNCTION serialize_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM saas_lock(NEW.clinic_id); RETURN NEW; END $$;
CREATE TRIGGER serialize_subscription BEFORE UPDATE ON clinic_subscriptions FOR EACH ROW EXECUTE FUNCTION serialize_subscription();
