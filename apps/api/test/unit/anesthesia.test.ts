import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createOpenApiDocument } from '@dentalai/contracts';
import {
  assessAnesthesia,
  AnesthesiaInputSchema,
  weightToKg,
  exposureToMg,
} from '@dentalai/domain';

const unknownInput = () => ({
  age: null,
  weight: null,
  solution: null,
  bloodPressure: null,
  allergies: { reviewed: false, items: [] },
  medications: { reviewed: false, items: [] },
  pregnancy: 'unknown',
  smoking: 'unknown',
  hepaticConditions: { reviewed: false, items: [] },
  renalConditions: { reviewed: false, items: [] },
  cardiovascularConditions: { reviewed: false, items: [] },
  otherContraindications: { reviewed: false, items: [] },
  exposure: { reviewed: false, doses: [] },
});
describe('single production anesthesia engine, no approved clinical constants', () => {
  it('publishes a draft-creation contract without claiming confirmation succeeds', () => {
    const document = createOpenApiDocument();
    const creation = document.paths['/api/v1/anesthesia/patients/{id}/assessments'];
    const confirmation = document.paths['/api/v1/anesthesia/assessments/{id}/confirm'];
    expect(creation).toMatchObject({
      post: { responses: { 201: { description: 'Validated response' } } },
    });
    expect(confirmation).toMatchObject({
      post: { responses: { 409: { description: 'Safe API error' } } },
    });
    expect(JSON.stringify(confirmation)).not.toContain('"200"');
  });
  it('returns explicit insufficient data with no numeric result', () => {
    const value = assessAnesthesia(unknownInput());
    expect(value.outcome).toBe('insufficient_data');
    expect(value.missingFields).toHaveLength(13);
    expect(value.maximumMg).toBeNull();
    expect(value.proposedMg).toBeNull();
    expect(value.contraindicationAssessment).toBe('not_evaluated');
    expect(value.warnings[0]?.code).toBe('REFERENCES_UNAPPROVED');
  });
  it('does not treat complete data or smoking as authorization to recommend', () => {
    const input = unknownInput();
    for (const smoking of ['never', 'former', 'current']) {
      const complete = {
        ...input,
        age: { value: 30, unit: 'years' },
        weight: { value: 70, unit: 'kg' },
        solution: {
          drug: 'Unapproved fictional product',
          concentrationMgMl: 1,
          cartridgeVolumeMl: 1,
          vasoconstrictor: null,
        },
        bloodPressure: { systolic: 120, diastolic: 80, unit: 'mmHg' },
        pregnancy: 'not_applicable',
        smoking,
        allergies: { reviewed: true, items: [] },
        medications: { reviewed: true, items: [] },
        hepaticConditions: { reviewed: true, items: [] },
        renalConditions: { reviewed: true, items: [] },
        cardiovascularConditions: { reviewed: true, items: [] },
        otherContraindications: { reviewed: true, items: [] },
        exposure: { reviewed: true, doses: [] },
      };
      const before = JSON.stringify(complete);
      const result = assessAnesthesia(complete);
      expect(result.outcome).toBe('do_not_calculate');
      expect(result.maximumMg).toBeNull();
      expect(result.proposedMg).toBeNull();
      expect(result.approvalState).toBe('draft');
      expect(JSON.stringify(complete)).toBe(before);
    }
  });
  it('has tested physical conversions without deriving dose limits', () => {
    expect(weightToKg(1, 'lb')).toBeCloseTo(0.45359237, 10);
    expect(weightToKg(70, 'kg')).toBe(70);
    expect(exposureToMg(0.001, 'g')).toBe(1);
    expect(exposureToMg(0, 'mg')).toBe(0);
    expect(() => exposureToMg(Number.MAX_SAFE_INTEGER, 'g')).toThrow();
    expect(() => weightToKg(Number.MIN_VALUE, 'lb')).toThrow();
  });
  it('rejects unknown fields, malformed units, ambiguous BP and invalid representations', () => {
    const base = unknownInput();
    for (const value of [NaN, Infinity, -Infinity, -1, 0, Number.MAX_VALUE, '70', null])
      for (const unit of ['kg', 'lb'])
        expect(AnesthesiaInputSchema.safeParse({ ...base, weight: { value, unit } }).success).toBe(
          false,
        );
    expect(() => assessAnesthesia({ ...base, bloodPressure: 120 })).toThrow();
    expect(() =>
      assessAnesthesia({ ...base, bloodPressure: { systolic: 80, diastolic: 120, unit: 'mmHg' } }),
    ).toThrow();
    expect(() => assessAnesthesia({ ...base, role: 'dentist' })).toThrow();
    expect(() => assessAnesthesia({ ...base, weight: { value: 70, unit: 'stones' } })).toThrow();
  });
  it('generated extreme-value property: valid representations never produce a dose or NaN', () => {
    for (let exponent = -300; exponent <= 15; exponent += 3)
      for (const unit of ['kg', 'lb']) {
        const result = assessAnesthesia({
          ...unknownInput(),
          weight: { value: 10 ** exponent, unit },
        });
        expect(result.recommendationEnabled).toBe(false);
        expect(result.maximumMg).toBeNull();
        expect(result.proposedMg).toBeNull();
        expect(JSON.stringify(result)).not.toContain('NaN');
      }
  });
  it('seeded property tests validate arbitrary extreme weights without producing recommendations', () => {
    fc.assert(
      fc.property(fc.double(), fc.constantFrom('kg', 'lb'), (value, unit) => {
        const input = { ...unknownInput(), weight: { value, unit } };
        const parsed = AnesthesiaInputSchema.safeParse(input);
        if (!parsed.success) {
          expect(() => assessAnesthesia(input)).toThrow();
          return;
        }
        const result = assessAnesthesia(input);
        expect(result.maximumMg).toBeNull();
        expect(result.proposedMg).toBeNull();
        expect(result.recommendationEnabled).toBe(false);
        expect(result).toEqual(assessAnesthesia(input));
      }),
      { seed: 20261009, numRuns: 2000 },
    );
  });
  it('seeded property tests reject arbitrary malformed input rather than emit a result', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        if (!AnesthesiaInputSchema.safeParse(raw).success)
          expect(() => assessAnesthesia(raw)).toThrow();
      }),
      { seed: 20261011, numRuns: 1000 },
    );
  });
});
