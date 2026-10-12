-- Execute as the migration identity AFTER each reviewed migration.
-- Create dentalai_app separately with a generated password via a private operator channel.
-- Never give the application ownership, SUPERUSER, BYPASSRLS, CREATEROLE or schema CREATE.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dentalai_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO dentalai_app;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM dentalai_app;
GRANT DELETE ON auth_sessions, auth_verifications, auth_rate_limits, login_attempts,
  membership_roles, billing_item_links, invoice_items, working_hours TO dentalai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dentalai_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events, security_events, clinical_revisions,
  billing_ledger, subscription_events, clinic_exports FROM dentalai_app;
-- Existing append-only triggers are an additional guard, NOT a substitute for separate ownership.
