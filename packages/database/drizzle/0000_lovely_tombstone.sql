CREATE TYPE "public"."ai_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."allergy_status" AS ENUM('active', 'inactive', 'resolved', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."anesthesia_approval_state" AS ENUM('draft', 'pending_review', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."clinical_note_status" AS ENUM('draft', 'signed', 'amended', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."clinician_review_status" AS ENUM('pending', 'accepted', 'rejected', 'needs_revision');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('open', 'signed', 'amended');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'available', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('active', 'resolved', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'partially_paid', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."medication_status" AS ENUM('active', 'stopped', 'completed', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'bank_transfer', 'insurance', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'voided', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."procedure_status" AS ENUM('planned', 'in_progress', 'completed', 'cancelled', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."staff_kind" AS ENUM('provider', 'staff');--> statement-breakpoint
CREATE TYPE "public"."treatment_plan_status" AS ENUM('draft', 'presented', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."xray_study_status" AS ENUM('ordered', 'acquired', 'reviewed', 'entered_in_error');--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"clinic_id" uuid PRIMARY KEY NOT NULL,
	"appointment_lead_minutes" integer DEFAULT 0 NOT NULL,
	"appointment_horizon_days" integer DEFAULT 365 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"default_timezone" text NOT NULL,
	"default_currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinics_slug_chk" CHECK ("clinics"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "clinics_currency_chk" CHECK ("clinics"."default_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "clinics_timezone_chk" CHECK (length(trim("clinics"."default_timezone")) > 0)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_membership_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country_code" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_timezone_chk" CHECK (length(trim("locations"."timezone")) > 0)
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"clinic_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_clinic_id_membership_id_role_id_pk" PRIMARY KEY("clinic_id","membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operatories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"portal_user_id" uuid,
	"medical_record_number" text NOT NULL,
	"given_name" text NOT NULL,
	"family_name" text NOT NULL,
	"preferred_name" text,
	"date_of_birth" date,
	"phone" text,
	"email" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_name_chk" CHECK (length(trim("patients"."given_name")) > 0 and length(trim("patients"."family_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"provider_type" text NOT NULL,
	"license_number" text,
	"license_region" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" "staff_kind" DEFAULT 'staff' NOT NULL,
	"employee_number" text,
	"title" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"provider_id" uuid,
	"weekday" integer NOT NULL,
	"opens_at_local" time NOT NULL,
	"closes_at_local" time NOT NULL,
	"valid_from" date,
	"valid_through" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_hours_weekday_chk" CHECK ("working_hours"."weekday" between 0 and 6),
	CONSTRAINT "working_hours_range_chk" CHECK ("working_hours"."opens_at_local" < "working_hours"."closes_at_local")
);
--> statement-breakpoint
CREATE TABLE "appointment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"reason" text,
	"changed_by_membership_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_status_history_change_chk" CHECK ("appointment_status_history"."from_status" is null or "appointment_status_history"."from_status" <> "appointment_status_history"."to_status")
);
--> statement-breakpoint
CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"default_duration_minutes" integer NOT NULL,
	"color" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_types_duration_chk" CHECK ("appointment_types"."default_duration_minutes" between 5 and 1440)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"operatory_id" uuid,
	"patient_id" uuid NOT NULL,
	"provider_id" uuid,
	"appointment_type_id" uuid NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"reason" text,
	"internal_notes" text,
	"created_by_membership_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_membership_id" uuid,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_range_chk" CHECK ("appointments"."starts_at" < "appointments"."ends_at"),
	CONSTRAINT "appointments_timezone_chk" CHECK (length(trim("appointments"."timezone")) > 0),
	CONSTRAINT "appointments_cancellation_chk" CHECK (("appointments"."status" not in ('cancelled', 'no_show')) or "appointments"."cancelled_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"operatory_id" uuid,
	"provider_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_blocks_time_range_chk" CHECK ("schedule_blocks"."starts_at" < "schedule_blocks"."ends_at"),
	CONSTRAINT "schedule_blocks_resource_chk" CHECK ("schedule_blocks"."operatory_id" is not null or "schedule_blocks"."provider_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "allergies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"substance" text NOT NULL,
	"reaction" text,
	"severity" text,
	"status" "allergy_status" DEFAULT 'active' NOT NULL,
	"onset_date" date,
	"recorded_by_membership_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "allergies_substance_chk" CHECK (length(trim("allergies"."substance")) > 0)
);
--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"note_group_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"supersedes_note_id" uuid,
	"status" "clinical_note_status" NOT NULL,
	"note_type" text NOT NULL,
	"body" text NOT NULL,
	"authored_by_membership_id" uuid NOT NULL,
	"signed_at" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_notes_version_chk" CHECK ("clinical_notes"."version" >= 1),
	CONSTRAINT "clinical_notes_body_chk" CHECK (length(trim("clinical_notes"."body")) > 0),
	CONSTRAINT "clinical_notes_signed_chk" CHECK ("clinical_notes"."status" = 'draft' or "clinical_notes"."signed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"provider_id" uuid NOT NULL,
	"status" "encounter_status" DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounters_time_range_chk" CHECK ("encounters"."ended_at" is null or "encounters"."started_at" <= "encounters"."ended_at"),
	CONSTRAINT "encounters_signature_chk" CHECK ("encounters"."status" = 'open' or ("encounters"."signed_at" is not null and "encounters"."signed_by_membership_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "medical_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"active" boolean DEFAULT true NOT NULL,
	"recorded_by_membership_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medical_alerts_title_chk" CHECK (length(trim("medical_alerts"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"medication_name" text NOT NULL,
	"dose" text,
	"route" text,
	"frequency" text,
	"status" "medication_status" DEFAULT 'active' NOT NULL,
	"started_on" date,
	"ended_on" date,
	"recorded_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medications_name_chk" CHECK (length(trim("medications"."medication_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "odontogram_finding_surfaces" (
	"clinic_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"surface_code" text NOT NULL,
	CONSTRAINT "odontogram_finding_surfaces_clinic_id_finding_id_surface_code_pk" PRIMARY KEY("clinic_id","finding_id","surface_code"),
	CONSTRAINT "odontogram_finding_surfaces_code_chk" CHECK ("odontogram_finding_surfaces"."surface_code" in ('M', 'O', 'D', 'B', 'L', 'I', 'F'))
);
--> statement-breakpoint
CREATE TABLE "odontogram_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"tooth_code" text NOT NULL,
	"dentition" text NOT NULL,
	"finding_code" text NOT NULL,
	"status" "finding_status" DEFAULT 'active' NOT NULL,
	"details" text,
	"recorded_by_membership_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "odontogram_findings_tooth_chk" CHECK (length(trim("odontogram_findings"."tooth_code")) > 0),
	CONSTRAINT "odontogram_findings_dentition_chk" CHECK ("odontogram_findings"."dentition" in ('primary', 'permanent'))
);
--> statement-breakpoint
CREATE TABLE "procedure_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"from_status" "procedure_status",
	"to_status" "procedure_status" NOT NULL,
	"changed_by_membership_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedure_surfaces" (
	"clinic_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"surface_code" text NOT NULL,
	CONSTRAINT "procedure_surfaces_clinic_id_procedure_id_surface_code_pk" PRIMARY KEY("clinic_id","procedure_id","surface_code"),
	CONSTRAINT "procedure_surfaces_code_chk" CHECK ("procedure_surfaces"."surface_code" in ('M', 'O', 'D', 'B', 'L', 'I', 'F'))
);
--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"provider_id" uuid NOT NULL,
	"service_id" uuid,
	"tooth_code" text,
	"dentition" text,
	"procedure_code" text NOT NULL,
	"description" text NOT NULL,
	"status" "procedure_status" DEFAULT 'planned' NOT NULL,
	"performed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedures_dentition_chk" CHECK ("procedures"."dentition" is null or "procedures"."dentition" in ('primary', 'permanent')),
	CONSTRAINT "procedures_completion_chk" CHECK ("procedures"."status" <> 'completed' or "procedures"."performed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"treatment_plan_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"tooth_code" text,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"estimated_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "procedure_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_items_sequence_chk" CHECK ("treatment_plan_items"."sequence" >= 1),
	CONSTRAINT "treatment_plan_items_quantity_chk" CHECK ("treatment_plan_items"."quantity" > 0),
	CONSTRAINT "treatment_plan_items_money_chk" CHECK ("treatment_plan_items"."estimated_amount_minor" >= 0),
	CONSTRAINT "treatment_plan_items_currency_chk" CHECK ("treatment_plan_items"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "treatment_plan_status" DEFAULT 'draft' NOT NULL,
	"supersedes_plan_id" uuid,
	"presented_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plans_version_chk" CHECK ("treatment_plans"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_analysis_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"ai_analysis_run_id" uuid NOT NULL,
	"review_status" "clinician_review_status" NOT NULL,
	"reviewed_by_provider_id" uuid NOT NULL,
	"comment" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"xray_study_id" uuid NOT NULL,
	"status" "ai_run_status" DEFAULT 'queued' NOT NULL,
	"model_name" text,
	"model_version" text,
	"input_manifest" jsonb NOT NULL,
	"result_file_id" uuid,
	"failure_code" text,
	"failure_message" text,
	"review_status" "clinician_review_status" DEFAULT 'pending' NOT NULL,
	"requested_by_membership_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_analysis_runs_success_chk" CHECK ("ai_analysis_runs"."status" <> 'succeeded' or ("ai_analysis_runs"."model_name" is not null and "ai_analysis_runs"."model_version" is not null and "ai_analysis_runs"."result_file_id" is not null and "ai_analysis_runs"."completed_at" is not null)),
	CONSTRAINT "ai_analysis_runs_failure_chk" CHECK ("ai_analysis_runs"."status" <> 'failed' or ("ai_analysis_runs"."failure_code" is not null and "ai_analysis_runs"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "anesthesia_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"provider_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_assessment_id" uuid,
	"rule_set_version" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"modeled_output" jsonb,
	"approval_state" "anesthesia_approval_state" DEFAULT 'draft' NOT NULL,
	"approved_by_provider_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anesthesia_assessments_version_chk" CHECK ("anesthesia_assessments"."version" >= 1),
	CONSTRAINT "anesthesia_assessments_ruleset_chk" CHECK (length(trim("anesthesia_assessments"."rule_set_version")) > 0),
	CONSTRAINT "anesthesia_assessments_approval_chk" CHECK ("anesthesia_assessments"."approval_state" <> 'approved' or ("anesthesia_assessments"."approved_by_provider_id" is not null and "anesthesia_assessments"."approved_at" is not null and "anesthesia_assessments"."modeled_output" is not null))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"uploaded_by_membership_id" uuid NOT NULL,
	"available_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_size_chk" CHECK ("files"."size_bytes" >= 0),
	CONSTRAINT "files_sha256_chk" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_availability_chk" CHECK ("files"."status" <> 'available' or "files"."available_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "xray_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"ordered_by_provider_id" uuid,
	"study_type" text NOT NULL,
	"status" "xray_study_status" DEFAULT 'ordered' NOT NULL,
	"acquired_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xray_studies_acquired_chk" CHECK ("xray_studies"."status" = 'ordered' or "xray_studies"."acquired_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "xray_study_files" (
	"clinic_id" uuid NOT NULL,
	"xray_study_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "xray_study_files_clinic_id_xray_study_id_file_id_pk" PRIMARY KEY("clinic_id","xray_study_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"service_id" uuid,
	"procedure_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_items_quantity_chk" CHECK ("invoice_items"."quantity" > 0),
	CONSTRAINT "invoice_items_amounts_chk" CHECK ("invoice_items"."unit_amount_minor" >= 0 and "invoice_items"."discount_minor" >= 0 and "invoice_items"."tax_minor" >= 0 and "invoice_items"."line_total_minor" >= 0),
	CONSTRAINT "invoice_items_currency_chk" CHECK ("invoice_items"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"invoice_number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_currency_chk" CHECK ("invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_amounts_chk" CHECK ("invoices"."subtotal_minor" >= 0 and "invoices"."discount_minor" >= 0 and "invoices"."tax_minor" >= 0 and "invoices"."total_minor" >= 0 and "invoices"."balance_minor" >= 0 and "invoices"."balance_minor" <= "invoices"."total_minor"),
	CONSTRAINT "invoices_total_chk" CHECK ("invoices"."total_minor" = "invoices"."subtotal_minor" - "invoices"."discount_minor" + "invoices"."tax_minor"),
	CONSTRAINT "invoices_issued_chk" CHECK ("invoices"."status" = 'draft' or "invoices"."issued_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"invoice_id" uuid,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"external_reference" text,
	"received_at" timestamp with time zone,
	"recorded_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_currency_chk" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_received_chk" CHECK ("payments"."status" <> 'succeeded' or "payments"."received_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_items_amount_chk" CHECK ("price_list_items"."amount_minor" >= 0),
	CONSTRAINT "price_list_items_currency_chk" CHECK ("price_list_items"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_through" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_currency_chk" CHECK ("price_lists"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "price_lists_range_chk" CHECK ("price_lists"."effective_through" is null or "price_lists"."effective_from" < "price_lists"."effective_through")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"external_reference" text,
	"refunded_at" timestamp with time zone,
	"recorded_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_chk" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_currency_chk" CHECK ("refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_reason_chk" CHECK (length(trim("refunds"."reason")) > 0),
	CONSTRAINT "refunds_completed_chk" CHECK ("refunds"."status" <> 'succeeded' or "refunds"."refunded_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"request_id" text,
	"ip_address" "inet",
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_action_chk" CHECK (length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_chk" CHECK (length(trim("audit_events"."entity_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_jobs_attempts_chk" CHECK ("outbox_jobs"."attempts" >= 0),
	CONSTRAINT "outbox_jobs_topic_chk" CHECK (length(trim("outbox_jobs"."topic")) > 0)
);
--> statement-breakpoint
-- Composite tenant foreign keys below require their referenced keys before the
-- foreign keys are created. Drizzle emits the corresponding named indexes at
-- the end of this migration, which is too late for PostgreSQL validation.
ALTER TABLE "roles" ADD CONSTRAINT "roles_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "operatories" ADD CONSTRAINT "operatories_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "xray_studies" ADD CONSTRAINT "xray_studies_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_clinic_id_tenant_key" UNIQUE ("clinic_id", "id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_currency_tenant_key" UNIQUE ("clinic_id", "id", "currency");--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_clinic_id_currency_tenant_key" UNIQUE ("clinic_id", "id", "currency");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_currency_tenant_key" UNIQUE ("clinic_id", "id", "currency");--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_tenant_fk" FOREIGN KEY ("clinic_id","role_id") REFERENCES "public"."roles"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_tenant_fk" FOREIGN KEY ("clinic_id","membership_id") REFERENCES "public"."memberships"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_tenant_fk" FOREIGN KEY ("clinic_id","role_id") REFERENCES "public"."roles"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operatories" ADD CONSTRAINT "operatories_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operatories" ADD CONSTRAINT "operatories_location_tenant_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_portal_user_id_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_staff_tenant_fk" FOREIGN KEY ("clinic_id","staff_id") REFERENCES "public"."staff"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_membership_tenant_fk" FOREIGN KEY ("clinic_id","membership_id") REFERENCES "public"."memberships"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_location_tenant_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_provider_tenant_fk" FOREIGN KEY ("clinic_id","provider_id") REFERENCES "public"."providers"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_tenant_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "public"."appointments"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_actor_tenant_fk" FOREIGN KEY ("clinic_id","changed_by_membership_id") REFERENCES "public"."memberships"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_tenant_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_operatory_tenant_fk" FOREIGN KEY ("clinic_id","operatory_id") REFERENCES "public"."operatories"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_provider_tenant_fk" FOREIGN KEY ("clinic_id","provider_id") REFERENCES "public"."providers"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_type_tenant_fk" FOREIGN KEY ("clinic_id","appointment_type_id") REFERENCES "public"."appointment_types"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_tenant_fk" FOREIGN KEY ("clinic_id","created_by_membership_id") REFERENCES "public"."memberships"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_location_tenant_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_operatory_tenant_fk" FOREIGN KEY ("clinic_id","operatory_id") REFERENCES "public"."operatories"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_provider_tenant_fk" FOREIGN KEY ("clinic_id","provider_id") REFERENCES "public"."providers"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_encounter_tenant_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "public"."encounters"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_author_tenant_fk" FOREIGN KEY ("clinic_id","authored_by_membership_id") REFERENCES "public"."memberships"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_tenant_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "public"."appointments"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_provider_tenant_fk" FOREIGN KEY ("clinic_id","provider_id") REFERENCES "public"."providers"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_alerts" ADD CONSTRAINT "medical_alerts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_alerts" ADD CONSTRAINT "medical_alerts_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_finding_surfaces" ADD CONSTRAINT "odontogram_finding_surfaces_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_finding_surfaces" ADD CONSTRAINT "odontogram_finding_surfaces_finding_tenant_fk" FOREIGN KEY ("clinic_id","finding_id") REFERENCES "public"."odontogram_findings"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_status_history" ADD CONSTRAINT "procedure_status_history_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_status_history" ADD CONSTRAINT "procedure_status_history_procedure_tenant_fk" FOREIGN KEY ("clinic_id","procedure_id") REFERENCES "public"."procedures"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_surfaces" ADD CONSTRAINT "procedure_surfaces_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_surfaces" ADD CONSTRAINT "procedure_surfaces_procedure_tenant_fk" FOREIGN KEY ("clinic_id","procedure_id") REFERENCES "public"."procedures"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_provider_tenant_fk" FOREIGN KEY ("clinic_id","provider_id") REFERENCES "public"."providers"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_plan_tenant_fk" FOREIGN KEY ("clinic_id","treatment_plan_id") REFERENCES "public"."treatment_plans"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_reviews" ADD CONSTRAINT "ai_analysis_reviews_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_reviews" ADD CONSTRAINT "ai_analysis_reviews_run_tenant_fk" FOREIGN KEY ("clinic_id","ai_analysis_run_id") REFERENCES "public"."ai_analysis_runs"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_reviews" ADD CONSTRAINT "ai_analysis_reviews_provider_tenant_fk" FOREIGN KEY ("clinic_id","reviewed_by_provider_id") REFERENCES "public"."providers"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_study_tenant_fk" FOREIGN KEY ("clinic_id","xray_study_id") REFERENCES "public"."xray_studies"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_result_file_tenant_fk" FOREIGN KEY ("clinic_id","result_file_id") REFERENCES "public"."files"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anesthesia_assessments" ADD CONSTRAINT "anesthesia_assessments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anesthesia_assessments" ADD CONSTRAINT "anesthesia_assessments_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anesthesia_assessments" ADD CONSTRAINT "anesthesia_assessments_provider_tenant_fk" FOREIGN KEY ("clinic_id","provider_id") REFERENCES "public"."providers"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploader_tenant_fk" FOREIGN KEY ("clinic_id","uploaded_by_membership_id") REFERENCES "public"."memberships"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_studies" ADD CONSTRAINT "xray_studies_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_studies" ADD CONSTRAINT "xray_studies_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_studies" ADD CONSTRAINT "xray_studies_encounter_tenant_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "public"."encounters"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_study_files" ADD CONSTRAINT "xray_study_files_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_study_files" ADD CONSTRAINT "xray_study_files_study_tenant_fk" FOREIGN KEY ("clinic_id","xray_study_id") REFERENCES "public"."xray_studies"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_study_files" ADD CONSTRAINT "xray_study_files_file_tenant_fk" FOREIGN KEY ("clinic_id","file_id") REFERENCES "public"."files"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_currency_tenant_fk" FOREIGN KEY ("clinic_id","invoice_id","currency") REFERENCES "public"."invoices"("clinic_id","id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_service_tenant_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "public"."services"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_procedure_tenant_fk" FOREIGN KEY ("clinic_id","procedure_id") REFERENCES "public"."procedures"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_encounter_tenant_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "public"."encounters"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_tenant_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_currency_tenant_fk" FOREIGN KEY ("clinic_id","invoice_id","currency") REFERENCES "public"."invoices"("clinic_id","id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_list_currency_tenant_fk" FOREIGN KEY ("clinic_id","price_list_id","currency") REFERENCES "public"."price_lists"("clinic_id","id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_service_tenant_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "public"."services"("clinic_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_currency_tenant_fk" FOREIGN KEY ("clinic_id","payment_id","currency") REFERENCES "public"."payments"("clinic_id","id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_id_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinics_slug_uidx" ON "clinics" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uidx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email_uidx" ON "invitations" USING btree ("clinic_id",lower("email")) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "locations_clinic_name_uidx" ON "locations" USING btree ("clinic_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_clinic_id_uidx" ON "locations" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_clinic_user_uidx" ON "memberships" USING btree ("clinic_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_clinic_id_uidx" ON "memberships" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operatories_clinic_location_name_uidx" ON "operatories" USING btree ("clinic_id","location_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "operatories_clinic_id_uidx" ON "operatories" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_mrn_uidx" ON "patients" USING btree ("clinic_id","medical_record_number");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_id_uidx" ON "patients" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_portal_user_uidx" ON "patients" USING btree ("clinic_id","portal_user_id") WHERE "patients"."portal_user_id" is not null;--> statement-breakpoint
CREATE INDEX "patients_clinic_name_idx" ON "patients" USING btree ("clinic_id","family_name","given_name");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_clinic_staff_uidx" ON "providers" USING btree ("clinic_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_clinic_id_uidx" ON "providers" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_clinic_key_uidx" ON "roles" USING btree ("clinic_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_clinic_id_uidx" ON "roles" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uidx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_expires_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_clinic_membership_uidx" ON "staff" USING btree ("clinic_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_clinic_id_uidx" ON "staff" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "working_hours_schedule_idx" ON "working_hours" USING btree ("clinic_id","location_id","provider_id","weekday");--> statement-breakpoint
CREATE INDEX "appointment_status_history_timeline_idx" ON "appointment_status_history" USING btree ("clinic_id","appointment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_types_clinic_code_uidx" ON "appointment_types" USING btree ("clinic_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_types_clinic_id_uidx" ON "appointment_types" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_clinic_id_uidx" ON "appointments" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "appointments_clinic_start_idx" ON "appointments" USING btree ("clinic_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_start_idx" ON "appointments" USING btree ("clinic_id","patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_provider_start_idx" ON "appointments" USING btree ("clinic_id","provider_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_blocks_clinic_id_uidx" ON "schedule_blocks" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "schedule_blocks_time_idx" ON "schedule_blocks" USING btree ("clinic_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "allergies_clinic_id_uidx" ON "allergies" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "allergies_patient_status_idx" ON "allergies" USING btree ("clinic_id","patient_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_notes_clinic_id_uidx" ON "clinical_notes" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_notes_group_version_uidx" ON "clinical_notes" USING btree ("clinic_id","note_group_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_notes_current_uidx" ON "clinical_notes" USING btree ("clinic_id","note_group_id") WHERE "clinical_notes"."is_current";--> statement-breakpoint
CREATE INDEX "clinical_notes_patient_idx" ON "clinical_notes" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_clinic_id_uidx" ON "encounters" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_clinic_appointment_uidx" ON "encounters" USING btree ("clinic_id","appointment_id") WHERE "encounters"."appointment_id" is not null;--> statement-breakpoint
CREATE INDEX "encounters_patient_started_idx" ON "encounters" USING btree ("clinic_id","patient_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "medical_alerts_clinic_id_uidx" ON "medical_alerts" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "medical_alerts_patient_active_idx" ON "medical_alerts" USING btree ("clinic_id","patient_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "medications_clinic_id_uidx" ON "medications" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "medications_patient_status_idx" ON "medications" USING btree ("clinic_id","patient_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "odontogram_findings_clinic_id_uidx" ON "odontogram_findings" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "odontogram_findings_patient_tooth_idx" ON "odontogram_findings" USING btree ("clinic_id","patient_id","tooth_code");--> statement-breakpoint
CREATE INDEX "procedure_status_history_timeline_idx" ON "procedure_status_history" USING btree ("clinic_id","procedure_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "procedures_clinic_id_uidx" ON "procedures" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "procedures_patient_idx" ON "procedures" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_items_plan_sequence_uidx" ON "treatment_plan_items" USING btree ("clinic_id","treatment_plan_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_items_clinic_id_uidx" ON "treatment_plan_items" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plans_clinic_id_uidx" ON "treatment_plans" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "treatment_plans_patient_idx" ON "treatment_plans" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_analysis_reviews_run_idx" ON "ai_analysis_reviews" USING btree ("clinic_id","ai_analysis_run_id","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_analysis_runs_clinic_id_uidx" ON "ai_analysis_runs" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "ai_analysis_runs_study_idx" ON "ai_analysis_runs" USING btree ("clinic_id","xray_study_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "anesthesia_assessments_clinic_id_uidx" ON "anesthesia_assessments" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "anesthesia_assessments_patient_idx" ON "anesthesia_assessments" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "files_clinic_id_uidx" ON "files" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_object_uidx" ON "files" USING btree ("clinic_id","storage_provider","bucket","object_key");--> statement-breakpoint
CREATE INDEX "files_patient_idx" ON "files" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xray_studies_clinic_id_uidx" ON "xray_studies" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "xray_studies_patient_idx" ON "xray_studies" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xray_study_files_sequence_uidx" ON "xray_study_files" USING btree ("clinic_id","xray_study_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_clinic_id_uidx" ON "invoice_items" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("clinic_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_number_uidx" ON "invoices" USING btree ("clinic_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_id_currency_uidx" ON "invoices" USING btree ("clinic_id","id","currency");--> statement-breakpoint
CREATE INDEX "invoices_patient_idx" ON "invoices" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_clinic_id_uidx" ON "payments" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_clinic_external_uidx" ON "payments" USING btree ("clinic_id","external_reference") WHERE "payments"."external_reference" is not null;--> statement-breakpoint
CREATE INDEX "payments_patient_idx" ON "payments" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_service_uidx" ON "price_list_items" USING btree ("clinic_id","price_list_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_clinic_id_uidx" ON "price_list_items" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_clinic_name_effective_uidx" ON "price_lists" USING btree ("clinic_id","name","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_clinic_id_currency_uidx" ON "price_lists" USING btree ("clinic_id","id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_clinic_id_uidx" ON "refunds" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("clinic_id","payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "services_clinic_code_uidx" ON "services" USING btree ("clinic_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "services_clinic_id_uidx" ON "services" USING btree ("clinic_id","id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("clinic_id","entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("clinic_id","actor_user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_clinic_idempotency_uidx" ON "outbox_jobs" USING btree ("clinic_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_jobs_pending_idx" ON "outbox_jobs" USING btree ("available_at","created_at") WHERE "outbox_jobs"."status" in ('pending', 'failed');
