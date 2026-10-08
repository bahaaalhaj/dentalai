-- OPTIONAL OPERATOR CUTOVER SCRIPT: review/backup the Supabase database first.
-- Apply only after the PostgreSQL appointment runtime and any required data import
-- have been reconciled. This closes the legacy public/full-row availability path;
-- it does not delete appointments or migrate clinical/billing data.
BEGIN;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Patients view own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Doctors view all appointments" ON public.appointments;
DROP POLICY IF EXISTS "Anyone can view appts for availability" ON public.appointments;
DROP POLICY IF EXISTS "Patients insert own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Patients delete own appointments" ON public.appointments;
REVOKE ALL ON public.appointments FROM PUBLIC, anon, authenticated;
COMMIT;
