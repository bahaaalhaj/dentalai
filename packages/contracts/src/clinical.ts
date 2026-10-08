import { z } from 'zod';
import { toothProblem } from '@dentalai/domain';
import { IdParamsSchema, SuccessSchema } from './auth.js';

const text = z.string().trim().min(1).max(4000);
const optionalText = z.string().trim().max(4000).nullable();
const tooth = z.string().regex(/^(?:[1-4][1-8]|[5-8][1-5])$/, 'Use FDI two-digit tooth notation.');
const surfaces = z.array(z.enum(['M', 'D', 'B', 'F', 'L', 'O', 'I'])).max(5);
const toothFields = { toothCode: tooth.nullable(), surfaces };
export const DemographicsSchema = z
  .object({
    kind: z.literal('demographics'),
    givenName: text.max(100),
    familyName: text.max(100),
    preferredName: optionalText,
    dateOfBirth: z.iso.date().nullable(),
    phone: optionalText,
    email: z.email().nullable(),
  })
  .strict();
const NoteSchema = z
  .object({
    kind: z.literal('note'),
    noteType: z.enum(['progress', 'consultation', 'correction']),
    body: text,
  })
  .strict();
const AlertSchema = z
  .object({
    kind: z.literal('alert'),
    title: text,
    details: optionalText,
    severity: z.enum(['info', 'warning', 'critical']),
    active: z.boolean(),
  })
  .strict();
const AllergySchema = z
  .object({
    kind: z.literal('allergy'),
    substance: text,
    reaction: optionalText,
    severity: optionalText,
    status: z.enum(['active', 'inactive', 'resolved', 'entered_in_error']),
  })
  .strict();
const MedicationSchema = z
  .object({
    kind: z.literal('medication'),
    medicationName: text,
    dose: optionalText,
    route: optionalText,
    frequency: optionalText,
    status: z.enum(['active', 'stopped', 'completed', 'entered_in_error']),
  })
  .strict();
const FindingSchema = z
  .object({
    kind: z.literal('finding'),
    toothCode: tooth,
    surfaces,
    findingCode: z.enum([
      'healthy',
      'caries',
      'missing',
      'restoration',
      'fracture',
      'periapical_lesion',
    ]),
    status: z.enum(['active', 'resolved', 'entered_in_error']),
    details: optionalText,
  })
  .strict();
const ProcedureSchema = z
  .object({
    kind: z.literal('procedure'),
    ...toothFields,
    procedureCode: z.enum(['restoration', 'extraction', 'root_canal', 'crown', 'implant', 'other']),
    description: text,
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled', 'entered_in_error']),
  })
  .strict();
export const PlanItemSchema = z
  .object({
    ...toothFields,
    serviceId: z.uuid(),
    description: text,
    quantity: z.number().int().min(1).max(100),
    estimatedAmountMinor: z.number().int().min(0).max(2147483647),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled', 'entered_in_error']),
  })
  .strict();
const PlanSchema = z
  .object({
    kind: z.literal('plan'),
    name: text,
    status: z.enum([
      'draft',
      'presented',
      'accepted',
      'rejected',
      'in_progress',
      'completed',
      'cancelled',
    ]),
    items: z.array(PlanItemSchema).min(1).max(50),
  })
  .strict();
export const ClinicalContentSchema = z
  .discriminatedUnion('kind', [
    DemographicsSchema,
    NoteSchema,
    AlertSchema,
    AllergySchema,
    MedicationSchema,
    FindingSchema,
    ProcedureSchema,
    PlanSchema,
  ])
  .superRefine((data, context) => {
    const check = (code: string | null, selected: string[], path: (string | number)[]) => {
      const problem = toothProblem(code, selected);
      if (problem) context.addIssue({ code: 'custom', message: problem, path });
    };
    if (data.kind === 'finding' || data.kind === 'procedure') {
      check(data.toothCode, data.surfaces, ['surfaces']);
      if (data.kind === 'finding' && data.findingCode === 'missing' && data.surfaces.length)
        context.addIssue({
          code: 'custom',
          message: 'Missing teeth have no surfaces.',
          path: ['surfaces'],
        });
      if (data.kind === 'procedure' && data.procedureCode !== 'other' && !data.toothCode)
        context.addIssue({
          code: 'custom',
          message: 'This procedure requires a tooth.',
          path: ['toothCode'],
        });
    }
    if (data.kind === 'plan')
      data.items.forEach((item, index) =>
        check(item.toothCode, item.surfaces, ['items', index, 'surfaces']),
      );
  });
export const ClinicalWriteSchema = z
  .object({
    encounterId: z.uuid(),
    supersedesId: z.uuid().nullable(),
    reason: text,
    data: ClinicalContentSchema,
  })
  .strict();
export const ClinicalReviewSchema = z
  .object({ decision: z.enum(['approved', 'rejected']), reason: text })
  .strict();
export const EncounterCreateSchema = z
  .object({ reason: text, appointmentId: z.uuid().nullable() })
  .strict();
export const EncounterCloseSchema = z.object({ reason: text }).strict();
export const ClinicalQuerySchema = z.object({ encounterId: z.uuid().optional() }).strict();
export const EncounterSchema = z.object({
  id: z.uuid(),
  status: z.enum(['open', 'signed', 'amended']),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  authorName: z.string(),
});
export const ClinicalRecordSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  version: z.number().int().positive(),
  encounterId: z.uuid(),
  authorName: z.string(),
  recordedAt: z.iso.datetime(),
  reason: z.string(),
  approval: z.enum(['pending', 'approved', 'rejected']),
  approvedAt: z.iso.datetime().nullable(),
  reviewReason: z.string().nullable(),
  data: ClinicalContentSchema,
});
export const PatientSummarySchema = z.object({
  id: z.uuid(),
  givenName: z.string(),
  familyName: z.string(),
  medicalRecordNumber: z.string(),
});
export const LegacyClinicalRecordSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  fields: z.array(z.object({ name: z.string(), value: z.string().nullable() })),
});
export const ClinicalWorkspaceSchema = z.object({
  patient: PatientSummarySchema,
  encounters: z.array(EncounterSchema),
  records: z.array(ClinicalRecordSchema),
  history: z.array(ClinicalRecordSchema),
  legacyRecords: z.array(LegacyClinicalRecordSchema),
  services: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export const PortalRecordSchema = ClinicalRecordSchema.pick({
  id: true,
  encounterId: true,
  recordedAt: true,
  data: true,
}).extend({
  approvedAt: z.iso.datetime(),
  version: z.number().int().positive(),
  superseded: z.boolean(),
});
export const ClinicalPortalSchema = z.object({
  records: z.array(PortalRecordSchema),
  history: z.array(PortalRecordSchema),
});
export type ClinicalContent = z.infer<typeof ClinicalContentSchema>;
export type ClinicalWrite = z.infer<typeof ClinicalWriteSchema>;
export type ClinicalRecord = z.infer<typeof ClinicalRecordSchema>;
export type ClinicalWorkspace = z.infer<typeof ClinicalWorkspaceSchema>;
export type ClinicalPortal = z.infer<typeof ClinicalPortalSchema>;
export const clinicalContracts = [
  {
    method: 'get',
    path: '/api/v1/clinical/patients',
    response: z.array(PatientSummarySchema),
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/clinical/portal',
    query: ClinicalQuerySchema,
    response: ClinicalPortalSchema,
    public: false,
  },
  {
    method: 'get',
    path: '/api/v1/clinical/patients/{id}',
    params: IdParamsSchema,
    query: ClinicalQuerySchema,
    response: ClinicalWorkspaceSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/clinical/patients/{id}/encounters',
    params: IdParamsSchema,
    body: EncounterCreateSchema,
    response: EncounterSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/clinical/patients/{id}/records',
    params: IdParamsSchema,
    body: ClinicalWriteSchema,
    response: ClinicalRecordSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/clinical/records/{id}/review',
    params: IdParamsSchema,
    body: ClinicalReviewSchema,
    response: SuccessSchema,
    public: false,
  },
  {
    method: 'post',
    path: '/api/v1/clinical/encounters/{id}/close',
    params: IdParamsSchema,
    body: EncounterCloseSchema,
    response: SuccessSchema,
    public: false,
  },
] as const;
