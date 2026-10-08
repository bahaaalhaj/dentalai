import { z } from 'zod';

// Representation limits only, NOT clinical cutoffs or approved dose limits.
const positive = z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegative = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(500);
const history = z.object({ reviewed: z.boolean(), items: z.array(text).max(100) }).strict();
export const AnesthesiaInputSchema = z
  .object({
    age: z
      .object({ value: positive, unit: z.enum(['years', 'months']) })
      .strict()
      .nullable(),
    weight: z
      .object({ value: positive, unit: z.enum(['kg', 'lb']) })
      .strict()
      .nullable(),
    solution: z
      .object({
        drug: text,
        concentrationMgMl: positive,
        cartridgeVolumeMl: positive,
        vasoconstrictor: z
          .object({ drug: text, concentrationMgMl: nonnegative })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
    bloodPressure: z
      .object({ systolic: positive, diastolic: positive, unit: z.literal('mmHg') })
      .strict()
      .refine((v) => v.systolic > v.diastolic, 'Systolic pressure must exceed diastolic pressure.')
      .nullable(),
    allergies: history,
    medications: history,
    pregnancy: z.enum(['unknown', 'not_pregnant', 'pregnant', 'not_applicable']),
    smoking: z.enum(['unknown', 'never', 'former', 'current']),
    hepaticConditions: history,
    renalConditions: history,
    cardiovascularConditions: history,
    otherContraindications: history,
    exposure: z
      .object({
        reviewed: z.boolean(),
        doses: z
          .array(
            z
              .object({
                drug: text,
                amount: nonnegative,
                unit: z.enum(['mg', 'g']),
                administeredAt: z.iso.datetime({ offset: true }),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  })
  .strict();
export type AnesthesiaInput = z.infer<typeof AnesthesiaInputSchema>;
export const ANESTHESIA_RULE_SET = Object.freeze({
  version: 'anesthesia-structure-v1',
  formularyVersion: 'unapproved-empty-v1',
  referenceSetVersion: null,
  approval: 'pending' as const,
  approvedReferences: [] as readonly string[],
  formulary: [] as readonly string[],
});
export const AnesthesiaOutputSchema = z
  .object({
    outcome: z.enum(['insufficient_data', 'do_not_calculate']),
    ruleSetVersion: z.literal('anesthesia-structure-v1'),
    formularyVersion: z.literal('unapproved-empty-v1'),
    referenceSetVersion: z.null(),
    recommendationEnabled: z.literal(false),
    maximumMg: z.null(),
    proposedMg: z.null(),
    approvalState: z.literal('draft'),
    missingFields: z.array(z.string()),
    steps: z.array(z.string()),
    warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    contraindications: z.array(z.string()),
    contraindicationAssessment: z.literal('not_evaluated'),
  })
  .strict();
export type AnesthesiaOutput = z.infer<typeof AnesthesiaOutputSchema>;

/** Pure fail-closed engine. There are intentionally no dose constants or demo formulas. */
export function assessAnesthesia(raw: unknown): AnesthesiaOutput {
  const input = AnesthesiaInputSchema.parse(raw);
  const missing: string[] = [];
  for (const field of ['age', 'weight', 'solution', 'bloodPressure'] as const)
    if (input[field] === null) missing.push(field);
  for (const field of [
    'allergies',
    'medications',
    'hepaticConditions',
    'renalConditions',
    'cardiovascularConditions',
    'otherContraindications',
    'exposure',
  ] as const)
    if (!input[field].reviewed) missing.push(field);
  for (const field of ['pregnancy', 'smoking'] as const)
    if (input[field] === 'unknown') missing.push(field);
  return {
    outcome: missing.length ? 'insufficient_data' : 'do_not_calculate',
    ruleSetVersion: ANESTHESIA_RULE_SET.version,
    formularyVersion: ANESTHESIA_RULE_SET.formularyVersion,
    referenceSetVersion: null,
    recommendationEnabled: false,
    maximumMg: null,
    proposedMg: null,
    approvalState: 'draft',
    missingFields: missing,
    steps: [
      'Validate explicit units and finite input representations.',
      'Check whether the clinician has reviewed each history and cumulative exposure field.',
      'Stop: no approved reference set or formulary exists. No dose arithmetic performed.',
    ],
    warnings: [
      {
        code: 'REFERENCES_UNAPPROVED',
        message:
          'Recommendations are unavailable pending approved clinical references and clinician-reviewed golden cases.',
      },
    ],
    contraindications: [],
    contraindicationAssessment: 'not_evaluated',
  };
}

// Physical unit conversions only; not medical thresholds. Engine deliberately does not use
// these to derive a dose until clinical rules and rounding policies have been approved.
export function weightToKg(value: number, unit: 'kg' | 'lb'): number {
  positive.parse(value);
  const result = unit === 'lb' ? value * 0.45359237 : value;
  return positive.parse(result);
}
export function exposureToMg(value: number, unit: 'mg' | 'g'): number {
  nonnegative.parse(value);
  return nonnegative.parse(unit === 'g' ? value * 1000 : value);
}
