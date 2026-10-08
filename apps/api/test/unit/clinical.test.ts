import { describe, expect, it } from 'vitest';
import {
  ClinicalContentSchema,
  ClinicalWriteSchema,
  createOpenApiDocument,
} from '@dentalai/contracts';
import { toothProblem, clinicalTransitionAllowed } from '@dentalai/domain';
import { validateClinicalRevision } from '../../src/domains/clinical/clinical.service.js';
const finding = {
  kind: 'finding' as const,
  toothCode: '16',
  surfaces: ['O' as const],
  findingCode: 'caries' as const,
  status: 'active' as const,
  details: null,
};
describe('clinical contracts and business rules', () => {
  it.each(['11', '48', '51', '85'])('accepts FDI tooth %s', (tooth) =>
    expect(toothProblem(tooth, [])).toBeUndefined(),
  );
  it.each(['0', '1', '19', '49', '56', '86', '99'])('rejects invalid FDI tooth %s', (tooth) =>
    expect(toothProblem(tooth, [])).toBeDefined(),
  );
  it('checks anterior/posterior surfaces, duplicates and absent teeth', () => {
    expect(toothProblem('11', ['I', 'F'])).toBeUndefined();
    expect(toothProblem('16', ['O', 'B'])).toBeUndefined();
    for (const [tooth, surfaces] of [
      ['11', ['O']],
      ['16', ['I']],
      ['16', ['O', 'O']],
      [null, ['M']],
    ] as const)
      expect(toothProblem(tooth, surfaces)).toBeDefined();
    expect(ClinicalContentSchema.safeParse({ ...finding, findingCode: 'missing' }).success).toBe(
      false,
    );
  });
  it('requires explicit actions and rejects browser authority fields', () => {
    expect(ClinicalContentSchema.safeParse({ ...finding, status: 'invented' }).success).toBe(false);
    expect(
      ClinicalWriteSchema.safeParse({
        encounterId: crypto.randomUUID(),
        supersedesId: null,
        reason: 'Fictional reason',
        data: finding,
        clinicId: crypto.randomUUID(),
        authorId: 'fake',
        approval: 'approved',
      }).success,
    ).toBe(false);
  });
  it('enforces lifecycle transitions and prevents clinical write type changes', () => {
    expect(clinicalTransitionAllowed('procedure', 'planned', 'completed')).toBe(true);
    expect(clinicalTransitionAllowed('procedure', 'completed', 'planned')).toBe(false);
    expect(() => validateClinicalRevision({ ...finding, status: 'resolved' })).toThrow(
      'initial entry',
    );
    expect(() =>
      validateClinicalRevision({ ...finding, status: 'resolved' }, finding),
    ).not.toThrow();
    expect(() =>
      validateClinicalRevision(
        { kind: 'note', noteType: 'progress', body: 'Fictional note' },
        finding,
      ),
    ).toThrow('retain its record type');
  });
  it('documents actual clinical API contracts', () => {
    const document = createOpenApiDocument();
    expect(document.paths).toHaveProperty('/api/v1/clinical/portal');
    expect(document.paths).toHaveProperty('/api/v1/clinical/patients/{id}/records');
  });
});
