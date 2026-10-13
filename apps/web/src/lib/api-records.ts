import {
  SuccessSchema,
  ClinicalWorkspaceSchema,
  ClinicalPortalSchema,
  ClinicalRecordSchema,
  ClinicalWriteSchema,
  ClinicalReviewSchema,
  EncounterSchema,
  PatientSummarySchema,
  type ClinicalWrite,
  ImagingHistorySchema,
  ImagingCapabilitiesSchema,
  ImagingImageSchema,
  ImagingRunSchema,
  ImagingReasonSchema,
  ImagingReviewSchema,
  AnesthesiaHistorySchema,
  AnesthesiaAssessmentSchema,
  AnesthesiaWriteSchema,
} from '@dentalai/contracts';
import { z } from 'zod';
import {
  BillingCatalogSchema,
  BillingInvoiceSchema,
  BillingMutationSchema,
  BillingLinksSchema,
  BillingReportSchema,
  InvoiceWriteSchema,
  DraftReplaceSchema,
  InvoiceActionSchema,
  PaymentWriteSchema,
  RefundWriteSchema,
  AdjustmentWriteSchema,
  ServiceWriteSchema,
  PricingWriteSchema,
} from '@dentalai/contracts';
import { SchedulingApiClient } from './api-scheduling.js';
// Cohesive capability; inherited guards/transport behavior are unchanged.
export class RecordsApiClient extends SchedulingApiClient {
  imagingHistory(patientId: string) {
    return this.get(`/api/v1/imaging/patients/${z.uuid().parse(patientId)}`, ImagingHistorySchema);
  }
  anesthesiaHistory(patientId: string) {
    return this.get(
      `/api/v1/anesthesia/patients/${z.uuid().parse(patientId)}`,
      AnesthesiaHistorySchema,
    );
  }
  assessAnesthesia(patientId: string, body: z.infer<typeof AnesthesiaWriteSchema>) {
    return this.post(
      `/api/v1/anesthesia/patients/${z.uuid().parse(patientId)}/assessments`,
      AnesthesiaWriteSchema.parse(body),
      AnesthesiaAssessmentSchema,
    );
  }
  imagingCapabilities() {
    return this.get('/api/v1/imaging/capabilities', ImagingCapabilitiesSchema);
  }
  uploadClinicalImage(
    patientId: string,
    file: File,
    reason: string,
    studyId?: string,
    requestKey?: string,
  ) {
    const query = studyId ? `?studyId=${z.uuid().parse(studyId)}` : '';
    return this.request(
      `/api/v1/imaging/patients/${z.uuid().parse(patientId)}/images${query}`,
      ImagingImageSchema,
      'POST',
      file,
      { mime: file.type, reason: ImagingReasonSchema.parse({ reason }).reason },
      requestKey,
    );
  }
  analyzeClinicalImage(imageId: string, reason: string, requestKey?: string) {
    return this.request(
      `/api/v1/imaging/images/${z.uuid().parse(imageId)}/analyses`,
      ImagingRunSchema,
      'POST',
      ImagingReasonSchema.parse({ reason }),
      undefined,
      requestKey,
    );
  }
  reviewClinicalImage(runId: string, decision: 'confirmed' | 'rejected', reason: string) {
    return this.request(
      `/api/v1/imaging/analyses/${z.uuid().parse(runId)}/review`,
      SuccessSchema,
      'POST',
      ImagingReviewSchema.parse({ decision, reason }),
    );
  }
  billingCatalog() {
    return this.get('/api/v1/billing/catalog', BillingCatalogSchema);
  }
  billingInvoices(portal = false) {
    return this.get(
      `/api/v1/billing/${portal ? 'portal' : 'invoices'}`,
      z.array(BillingInvoiceSchema),
    );
  }
  billingLinks(patientId: string) {
    return this.get(
      `/api/v1/billing/patients/${z.uuid().parse(patientId)}/links`,
      BillingLinksSchema,
    );
  }
  billingReports() {
    return this.get('/api/v1/billing/reports', BillingReportSchema);
  }
  createInvoice(body: z.infer<typeof InvoiceWriteSchema>) {
    return this.post(
      '/api/v1/billing/invoices',
      InvoiceWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  reviseInvoice(id: string, body: z.infer<typeof DraftReplaceSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/draft`,
      DraftReplaceSchema.parse(body),
      BillingMutationSchema,
    );
  }
  invoiceAction(
    id: string,
    action: 'issue' | 'discard',
    body: z.infer<typeof InvoiceActionSchema>,
  ) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/${action}`,
      InvoiceActionSchema.parse(body),
      BillingMutationSchema,
    );
  }
  recordPayment(id: string, body: z.infer<typeof PaymentWriteSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/payments`,
      PaymentWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  recordRefund(id: string, body: z.infer<typeof RefundWriteSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/refunds`,
      RefundWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  adjustInvoice(id: string, body: z.infer<typeof AdjustmentWriteSchema>) {
    return this.post(
      `/api/v1/billing/invoices/${z.uuid().parse(id)}/adjustments`,
      AdjustmentWriteSchema.parse(body),
      BillingMutationSchema,
    );
  }
  createBillingService(body: z.infer<typeof ServiceWriteSchema>) {
    return this.post(
      '/api/v1/billing/services',
      ServiceWriteSchema.parse(body),
      z.object({ success: z.literal(true) }),
    );
  }
  publishPrices(body: z.infer<typeof PricingWriteSchema>) {
    return this.post(
      '/api/v1/billing/price-lists',
      PricingWriteSchema.parse(body),
      z.object({ success: z.literal(true) }),
    );
  }
  clinicalPatients() {
    return this.get('/api/v1/clinical/patients', z.array(PatientSummarySchema));
  }
  clinicalWorkspace(id: string, encounterId?: string) {
    return this.get(
      `/api/v1/clinical/patients/${z.uuid().parse(id)}${encounterId ? `?encounterId=${z.uuid().parse(encounterId)}` : ''}`,
      ClinicalWorkspaceSchema,
    );
  }
  clinicalPortal() {
    return this.get('/api/v1/clinical/portal', ClinicalPortalSchema);
  }
  startEncounter(id: string, reason: string) {
    return this.request(
      `/api/v1/clinical/patients/${z.uuid().parse(id)}/encounters`,
      EncounterSchema,
      'POST',
      { reason, appointmentId: null },
    );
  }
  writeClinicalRecord(id: string, body: ClinicalWrite) {
    return this.request(
      `/api/v1/clinical/patients/${z.uuid().parse(id)}/records`,
      ClinicalRecordSchema,
      'POST',
      ClinicalWriteSchema.parse(body),
    );
  }
  reviewClinicalRecord(id: string, decision: 'approved' | 'rejected', reason: string) {
    return this.request(
      `/api/v1/clinical/records/${z.uuid().parse(id)}/review`,
      SuccessSchema,
      'POST',
      ClinicalReviewSchema.parse({ decision, reason }),
    );
  }
  closeEncounter(id: string, reason: string) {
    return this.request(
      `/api/v1/clinical/encounters/${z.uuid().parse(id)}/close`,
      SuccessSchema,
      'POST',
      { reason },
    );
  }
}
