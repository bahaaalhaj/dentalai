import { z } from 'zod';
import { AnesthesiaInputSchema, AnesthesiaOutputSchema } from '@dentalai/domain';
export { AnesthesiaInputSchema, AnesthesiaOutputSchema } from '@dentalai/domain';
export const AnesthesiaWriteSchema = z
  .object({
    input: AnesthesiaInputSchema,
    reason: z.string().trim().min(3).max(500),
    source: z.enum(['clinician_interview', 'clinician_record_review']),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const AnesthesiaAssessmentSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    input: AnesthesiaInputSchema,
    output: AnesthesiaOutputSchema,
    provenance: z
      .object({
        source: z.enum(['clinician_interview', 'clinician_record_review']),
        observedAt: z.iso.datetime({ offset: true }),
        authorUserId: z.uuid(),
        providerId: z.uuid(),
        reason: z.string(),
        requestId: z.string(),
      })
      .strict(),
    createdAt: z.string(),
    approvalState: z.literal('draft'),
  })
  .strict();
export const AnesthesiaHistorySchema = z.array(AnesthesiaAssessmentSchema);
export const AnesthesiaConfirmSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const anesthesiaContracts = [
  {
    method: 'get',
    path: '/api/v1/anesthesia/patients/{id}',
    public: false,
    params: z.object({ id: z.uuid() }),
    response: AnesthesiaHistorySchema,
  },
  {
    method: 'post',
    path: '/api/v1/anesthesia/patients/{id}/assessments',
    public: false,
    params: z.object({ id: z.uuid() }),
    body: AnesthesiaWriteSchema,
    successStatus: 201,
    response: AnesthesiaAssessmentSchema,
  },
  {
    method: 'post',
    path: '/api/v1/anesthesia/assessments/{id}/confirm',
    public: false,
    params: z.object({ id: z.uuid() }),
    body: AnesthesiaConfirmSchema,
    blocked: true,
    response: z.never(),
  },
] as const;
// Confirmation always returns 409 until an approved rule set exists; not a success contract.
