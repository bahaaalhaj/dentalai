-- Phase 9 is additive. Legacy invoices/payments are retained, not silently adopted or altered.
CREATE UNIQUE INDEX invoices_clinic_id_uidx ON invoices(clinic_id,id);--> statement-breakpoint
CREATE TABLE billing_invoice_workflows (
 invoice_id uuid PRIMARY KEY, clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1 CONSTRAINT billing_workflow_version_chk CHECK(version>0), discarded_at timestamptz,
 CONSTRAINT billing_workflow_invoice_fk FOREIGN KEY(clinic_id,invoice_id) REFERENCES invoices(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE TABLE billing_item_links (
 item_id uuid PRIMARY KEY, clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT, treatment_plan_item_id uuid NOT NULL,
 CONSTRAINT billing_link_item_fk FOREIGN KEY(clinic_id,item_id) REFERENCES invoice_items(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT billing_link_plan_item_fk FOREIGN KEY(clinic_id,treatment_plan_item_id) REFERENCES treatment_plan_items(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE TABLE billing_price_publications (
 price_list_id uuid PRIMARY KEY, clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT, currency text NOT NULL,
 author_membership_id uuid NOT NULL, reason text NOT NULL CONSTRAINT billing_publication_reason_chk CHECK(length(trim(reason))>0),
 CONSTRAINT billing_publication_list_fk FOREIGN KEY(clinic_id,price_list_id,currency) REFERENCES price_lists(clinic_id,id,currency) ON DELETE RESTRICT,
 CONSTRAINT billing_publication_author_fk FOREIGN KEY(clinic_id,author_membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE TABLE billing_ledger (
 id uuid PRIMARY KEY, clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT, invoice_id uuid NOT NULL,
 kind text NOT NULL, amount_minor bigint NOT NULL, currency text NOT NULL,
 payment_id uuid, refund_id uuid, receipt_reference text, author_membership_id uuid NOT NULL, reason text NOT NULL,
 request_key uuid NOT NULL, operation_hash text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT billing_ledger_invoice_fk FOREIGN KEY(clinic_id,invoice_id,currency) REFERENCES invoices(clinic_id,id,currency) ON DELETE RESTRICT,
 CONSTRAINT billing_ledger_payment_fk FOREIGN KEY(clinic_id,payment_id) REFERENCES payments(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT billing_ledger_refund_fk FOREIGN KEY(clinic_id,refund_id) REFERENCES refunds(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT billing_ledger_author_fk FOREIGN KEY(clinic_id,author_membership_id) REFERENCES memberships(clinic_id,id) ON DELETE RESTRICT,
 CONSTRAINT billing_ledger_kind_chk CHECK(kind IN ('draft_created','draft_revised','draft_discarded','invoice_issued','payment','refund','adjustment')),
 CONSTRAINT billing_ledger_amount_chk CHECK(abs(amount_minor)<=1000000000000 AND ((kind IN ('draft_created','draft_revised','draft_discarded') AND amount_minor=0) OR (kind IN ('invoice_issued','refund') AND amount_minor>0) OR (kind='payment' AND amount_minor<0) OR (kind='adjustment' AND amount_minor<>0))),
 CONSTRAINT billing_ledger_reason_chk CHECK(length(trim(reason))>0),
 CONSTRAINT billing_ledger_sources_chk CHECK((kind='payment' AND payment_id IS NOT NULL AND refund_id IS NULL AND receipt_reference IS NOT NULL) OR (kind='refund' AND payment_id IS NOT NULL AND refund_id IS NOT NULL AND receipt_reference IS NOT NULL) OR (kind NOT IN ('payment','refund') AND payment_id IS NULL AND refund_id IS NULL AND receipt_reference IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX billing_ledger_request_uidx ON billing_ledger(clinic_id,request_key);--> statement-breakpoint
CREATE UNIQUE INDEX billing_ledger_receipt_uidx ON billing_ledger(clinic_id,receipt_reference);--> statement-breakpoint
CREATE UNIQUE INDEX billing_ledger_payment_uidx ON billing_ledger(clinic_id,payment_id) WHERE kind='payment';--> statement-breakpoint
CREATE UNIQUE INDEX billing_ledger_refund_uidx ON billing_ledger(clinic_id,refund_id);--> statement-breakpoint
CREATE UNIQUE INDEX billing_ledger_issue_uidx ON billing_ledger(clinic_id,invoice_id) WHERE kind='invoice_issued';--> statement-breakpoint
CREATE INDEX billing_ledger_invoice_idx ON billing_ledger(clinic_id,invoice_id,recorded_at);--> statement-breakpoint
CREATE TRIGGER billing_ledger_immutable_trg BEFORE UPDATE OR DELETE ON billing_ledger FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint
CREATE TRIGGER billing_publication_immutable_trg BEFORE UPDATE OR DELETE ON billing_price_publications FOR EACH ROW EXECUTE FUNCTION dentalai_reject_change();--> statement-breakpoint

-- The parent lock is also taken for direct SQL writers, serializing financial checks per invoice.
CREATE FUNCTION dentalai_billing_ledger_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM invoices WHERE clinic_id=NEW.clinic_id AND id=NEW.invoice_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM billing_invoice_workflows WHERE clinic_id=NEW.clinic_id AND invoice_id=NEW.invoice_id) THEN
  RAISE EXCEPTION 'invoice requires workflow provenance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER billing_ledger_lock_trg BEFORE INSERT ON billing_ledger FOR EACH ROW EXECUTE FUNCTION dentalai_billing_ledger_lock();--> statement-breakpoint

CREATE FUNCTION dentalai_billing_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv invoices; balance numeric; charge numeric; issued numeric; payment payments; refund refunds; workflow billing_invoice_workflows;
BEGIN
 SELECT * INTO inv FROM invoices WHERE clinic_id=NEW.clinic_id AND id=NEW.invoice_id;
 SELECT * INTO workflow FROM billing_invoice_workflows WHERE clinic_id=NEW.clinic_id AND invoice_id=NEW.invoice_id;
 SELECT COALESCE(sum(amount_minor),0), COALESCE(sum(amount_minor) FILTER(WHERE kind IN ('invoice_issued','adjustment')),0),COALESCE(sum(amount_minor) FILTER(WHERE kind='invoice_issued'),0)
 INTO balance,charge,issued FROM billing_ledger WHERE clinic_id=NEW.clinic_id AND invoice_id=NEW.invoice_id;
 IF balance<0 OR balance>1000000000000 OR charge<0 OR charge>1000000000000 OR (inv.status='draft' AND charge<>0)
 OR (inv.status<>'draft' AND issued<>inv.total_minor) THEN RAISE EXCEPTION 'ledger balance or issued total invalid' USING ERRCODE='23514'; END IF;
 IF inv.subtotal_minor<>(SELECT COALESCE(sum(round(quantity*unit_amount_minor)),0) FROM invoice_items WHERE clinic_id=inv.clinic_id AND invoice_id=inv.id)
 OR inv.discount_minor<>(SELECT COALESCE(sum(discount_minor),0) FROM invoice_items WHERE clinic_id=inv.clinic_id AND invoice_id=inv.id)
 OR inv.tax_minor<>(SELECT COALESCE(sum(tax_minor),0) FROM invoice_items WHERE clinic_id=inv.clinic_id AND invoice_id=inv.id)
 OR inv.total_minor<>(SELECT COALESCE(sum(line_total_minor),0) FROM invoice_items WHERE clinic_id=inv.clinic_id AND invoice_id=inv.id)
 OR NOT EXISTS(SELECT 1 FROM invoice_items WHERE clinic_id=inv.clinic_id AND invoice_id=inv.id) THEN RAISE EXCEPTION 'invoice line reconciliation failed' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM invoice_items i WHERE i.clinic_id=inv.clinic_id AND i.invoice_id=inv.id AND i.line_total_minor<>round(i.quantity*i.unit_amount_minor)-i.discount_minor+i.tax_minor) THEN RAISE EXCEPTION 'invalid line arithmetic' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM invoice_items i JOIN procedures p ON p.clinic_id=i.clinic_id AND p.id=i.procedure_id WHERE i.invoice_id=inv.id AND p.patient_id<>inv.patient_id)
 OR EXISTS(SELECT 1 FROM invoice_items i JOIN billing_item_links l ON l.clinic_id=i.clinic_id AND l.item_id=i.id JOIN treatment_plan_items t ON t.clinic_id=l.clinic_id AND t.id=l.treatment_plan_item_id JOIN treatment_plans p ON p.clinic_id=t.clinic_id AND p.id=t.treatment_plan_id WHERE i.invoice_id=inv.id AND (p.patient_id<>inv.patient_id OR t.service_id IS DISTINCT FROM i.service_id)) THEN RAISE EXCEPTION 'clinical billing link ownership mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind='payment' THEN
  SELECT * INTO payment FROM payments WHERE clinic_id=NEW.clinic_id AND id=NEW.payment_id;
  IF payment.invoice_id IS DISTINCT FROM inv.id OR payment.patient_id<>inv.patient_id OR payment.currency<>NEW.currency OR payment.status<>'succeeded' OR payment.amount_minor<>-NEW.amount_minor THEN RAISE EXCEPTION 'payment ledger mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='refund' THEN
  SELECT * INTO payment FROM payments WHERE clinic_id=NEW.clinic_id AND id=NEW.payment_id;
  SELECT * INTO refund FROM refunds WHERE clinic_id=NEW.clinic_id AND id=NEW.refund_id;
  IF payment.invoice_id IS DISTINCT FROM inv.id OR refund.payment_id<>payment.id OR refund.currency<>NEW.currency OR refund.status<>'succeeded' OR refund.amount_minor<>NEW.amount_minor OR
   (SELECT COALESCE(sum(amount_minor),0) FROM billing_ledger WHERE clinic_id=NEW.clinic_id AND kind='refund' AND payment_id=NEW.payment_id)>payment.amount_minor THEN RAISE EXCEPTION 'refund ledger mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF workflow.discarded_at IS NOT NULL AND inv.status<>'draft' THEN RAISE EXCEPTION 'discarded invoice cannot be issued' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.clinic_id=NEW.clinic_id AND a.entity_id=NEW.id AND a.action='billing.'||NEW.kind AND a.actor_membership_id=NEW.author_membership_id AND a.data->>'invoiceId'=NEW.invoice_id::text AND a.data->>'patientId'=inv.patient_id::text AND a.data->>'reason'=NEW.reason AND a.data ? 'before' AND a.data ? 'after') THEN RAISE EXCEPTION 'financial event requires atomic audit evidence' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER billing_integrity_trg AFTER INSERT ON billing_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentalai_billing_integrity();--> statement-breakpoint

CREATE FUNCTION dentalai_billing_protect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; tenant uuid; inv invoices;
BEGIN
 IF TG_OP='UPDATE' AND (
  (to_jsonb(OLD)->>'clinic_id') IS DISTINCT FROM (to_jsonb(NEW)->>'clinic_id') OR
  (to_jsonb(OLD)->>'id') IS DISTINCT FROM (to_jsonb(NEW)->>'id') OR
  (to_jsonb(OLD)->>'invoice_id') IS DISTINCT FROM (to_jsonb(NEW)->>'invoice_id') OR
  (to_jsonb(OLD)->>'payment_id') IS DISTINCT FROM (to_jsonb(NEW)->>'payment_id') OR
  (to_jsonb(OLD)->>'item_id') IS DISTINCT FROM (to_jsonb(NEW)->>'item_id')) THEN
  RAISE EXCEPTION 'financial ownership and identity are immutable' USING ERRCODE='55000'; END IF;
 tenant:=COALESCE(to_jsonb(OLD)->>'clinic_id',to_jsonb(NEW)->>'clinic_id')::uuid;
 IF TG_TABLE_NAME='billing_invoice_workflows' THEN
  IF TG_OP='DELETE' OR NEW.invoice_id<>OLD.invoice_id OR NEW.clinic_id<>OLD.clinic_id OR NEW.version<>OLD.version+1 OR OLD.discarded_at IS NOT NULL THEN RAISE EXCEPTION 'invalid workflow change' USING ERRCODE='55000'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='invoices' THEN target:=COALESCE(to_jsonb(OLD)->>'id',to_jsonb(NEW)->>'id')::uuid;
 ELSIF TG_TABLE_NAME='invoice_items' THEN target:=COALESCE(to_jsonb(OLD)->>'invoice_id',to_jsonb(NEW)->>'invoice_id')::uuid;
 ELSIF TG_TABLE_NAME='billing_item_links' THEN SELECT invoice_id INTO target FROM invoice_items WHERE id=COALESCE(to_jsonb(OLD)->>'item_id',to_jsonb(NEW)->>'item_id')::uuid;
 ELSIF TG_TABLE_NAME='payments' THEN target:=COALESCE(to_jsonb(OLD)->>'invoice_id',to_jsonb(NEW)->>'invoice_id')::uuid;
 ELSIF TG_TABLE_NAME='refunds' THEN SELECT invoice_id INTO target FROM payments WHERE id=COALESCE(to_jsonb(OLD)->>'payment_id',to_jsonb(NEW)->>'payment_id')::uuid;
 END IF;
 SELECT * INTO inv FROM invoices WHERE clinic_id=tenant AND id=target FOR UPDATE;
 -- Issued legacy snapshots are frozen too; retaining them must not permit silent edits.
 IF (TG_TABLE_NAME='invoices' AND TG_OP='DELETE') OR
  (TG_TABLE_NAME NOT IN ('payments','refunds') AND inv.status<>'draft' AND NOT (TG_TABLE_NAME='invoices' AND TG_OP='INSERT')) THEN
  RAISE EXCEPTION 'historical issued invoice is immutable' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM billing_invoice_workflows WHERE clinic_id=tenant AND invoice_id=target) THEN
  IF TG_TABLE_NAME IN ('payments','refunds') THEN
   IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payment/refund history is immutable' USING ERRCODE='55000'; END IF;
  ELSIF (TG_TABLE_NAME='invoices' AND TG_OP='DELETE') OR inv.status<>'draft' OR EXISTS(SELECT 1 FROM billing_invoice_workflows WHERE clinic_id=tenant AND invoice_id=target AND discarded_at IS NOT NULL) THEN RAISE EXCEPTION 'issued or discarded invoice is immutable' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
DO $$ DECLARE target text; BEGIN FOREACH target IN ARRAY ARRAY['invoices','invoice_items','billing_item_links','payments','refunds'] LOOP
 EXECUTE format('CREATE TRIGGER billing_history_protect_trg BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dentalai_billing_protect()',target); END LOOP; END $$;--> statement-breakpoint
CREATE TRIGGER billing_workflow_protect_trg BEFORE UPDATE OR DELETE ON billing_invoice_workflows FOR EACH ROW EXECUTE FUNCTION dentalai_billing_protect();--> statement-breakpoint

CREATE FUNCTION dentalai_billing_price_protect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='price_lists' THEN COALESCE(to_jsonb(OLD)->>'id',to_jsonb(NEW)->>'id')::uuid ELSE COALESCE(to_jsonb(OLD)->>'price_list_id',to_jsonb(NEW)->>'price_list_id')::uuid END;
 IF EXISTS(SELECT 1 FROM billing_price_publications WHERE price_list_id=target) THEN RAISE EXCEPTION 'published price snapshot is immutable' USING ERRCODE='55000'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE TRIGGER billing_list_protect_trg BEFORE UPDATE OR DELETE ON price_lists FOR EACH ROW EXECUTE FUNCTION dentalai_billing_price_protect();--> statement-breakpoint
CREATE TRIGGER billing_price_item_protect_trg BEFORE INSERT OR UPDATE OR DELETE ON price_list_items FOR EACH ROW EXECUTE FUNCTION dentalai_billing_price_protect();--> statement-breakpoint

-- Source records and state changes cannot commit independently of a matching event.
-- Deferred checks allow the application to write header, items, ledger and audit in one transaction.
CREATE FUNCTION dentalai_billing_source_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb; target uuid; tenant uuid; inv invoices; workflow billing_invoice_workflows; current_xid text;
BEGIN
 doc:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 tenant:=(doc->>'clinic_id')::uuid;
 current_xid:=(pg_current_xact_id()::text::numeric % 4294967296)::text;
 IF TG_TABLE_NAME='billing_price_publications' THEN
  IF NOT EXISTS(SELECT 1 FROM audit_events WHERE clinic_id=tenant AND entity_id=(doc->>'price_list_id')::uuid
   AND action='billing.price_published' AND actor_membership_id=(doc->>'author_membership_id')::uuid
   AND data->>'reason'=doc->>'reason' AND xmin::text=current_xid) THEN
   RAISE EXCEPTION 'price publication requires atomic audit' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='invoices' THEN target:=(doc->>'id')::uuid;
 ELSIF TG_TABLE_NAME='billing_item_links' THEN SELECT invoice_id INTO target FROM invoice_items WHERE id=(doc->>'item_id')::uuid;
 ELSIF TG_TABLE_NAME='refunds' THEN SELECT invoice_id INTO target FROM payments WHERE id=(doc->>'payment_id')::uuid;
 ELSE target:=(doc->>'invoice_id')::uuid; END IF;
 SELECT * INTO workflow FROM billing_invoice_workflows WHERE clinic_id=tenant AND invoice_id=target;
 IF NOT FOUND THEN RETURN NULL; END IF; -- retained legacy history is not adopted
 SELECT * INTO inv FROM invoices WHERE clinic_id=tenant AND id=target;
 IF NOT EXISTS(SELECT 1 FROM billing_ledger WHERE clinic_id=tenant AND invoice_id=target AND xmin::text=current_xid)
 OR workflow.version<>(SELECT count(*) FROM billing_ledger WHERE clinic_id=tenant AND invoice_id=target)
 OR (inv.status<>'draft' AND inv.total_minor IS DISTINCT FROM (SELECT amount_minor FROM billing_ledger WHERE clinic_id=tenant AND invoice_id=target AND kind='invoice_issued'))
 OR (workflow.discarded_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_ledger WHERE clinic_id=tenant AND invoice_id=target AND kind='draft_discarded'))
 THEN RAISE EXCEPTION 'financial source requires matching atomic ledger event' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payments' AND NOT EXISTS(SELECT 1 FROM billing_ledger WHERE clinic_id=tenant AND payment_id=(doc->>'id')::uuid AND kind='payment')
 OR TG_TABLE_NAME='refunds' AND NOT EXISTS(SELECT 1 FROM billing_ledger WHERE clinic_id=tenant AND refund_id=(doc->>'id')::uuid AND kind='refund')
 THEN RAISE EXCEPTION 'payment or refund requires ledger source' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;--> statement-breakpoint
DO $$ DECLARE target text; BEGIN FOREACH target IN ARRAY ARRAY['invoices','invoice_items','billing_item_links','billing_invoice_workflows','payments','refunds','billing_price_publications'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER billing_source_integrity_trg AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentalai_billing_source_integrity()',target); END LOOP; END $$;
