-- Reviewed Phase 6 migration. Authentication tables are global identity infrastructure.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN image text;--> statement-breakpoint
UPDATE users SET email_verified = true WHERE email_verified_at IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX memberships_clinic_id_user_uidx ON memberships(clinic_id,id,user_id);--> statement-breakpoint
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  ip_address text, user_agent text,
  clinic_id uuid REFERENCES clinics(id) ON DELETE RESTRICT,
  active_membership_id uuid,
  CONSTRAINT auth_sessions_context_chk CHECK ((clinic_id IS NULL) = (active_membership_id IS NULL)),
  CONSTRAINT auth_sessions_membership_tenant_fk FOREIGN KEY (clinic_id, active_membership_id,user_id)
    REFERENCES memberships(clinic_id,id,user_id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);--> statement-breakpoint
CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id text NOT NULL, provider_id text NOT NULL,
  access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  scope text, password text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  CONSTRAINT auth_accounts_provider_account_unique UNIQUE(provider_id,account_id)
);--> statement-breakpoint
CREATE INDEX auth_accounts_user_idx ON auth_accounts(user_id);--> statement-breakpoint
CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications(identifier);--> statement-breakpoint
CREATE TABLE auth_rate_limits (
  id uuid PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, last_request bigint NOT NULL
);--> statement-breakpoint
CREATE TABLE login_attempts (
  key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0 CONSTRAINT login_attempts_failures_chk CHECK(failures >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(), blocked_until timestamptz
);--> statement-breakpoint
CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES clinics(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CONSTRAINT security_events_action_chk CHECK(length(trim(action)) > 0), success boolean NOT NULL,
  request_id text, data jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX security_events_user_time_idx ON security_events(user_id,occurred_at);--> statement-breakpoint
CREATE TRIGGER security_events_append_only_trg BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint
-- Seed a fixed role vocabulary for every existing clinic. Future provisioning does the same.
INSERT INTO roles(clinic_id,key,name)
SELECT c.id,r.key,r.key FROM clinics c CROSS JOIN
  (VALUES ('clinic_owner'),('clinic_admin'),('dentist'),('receptionist'),('patient')) r(key)
ON CONFLICT(clinic_id,key) DO NOTHING;
