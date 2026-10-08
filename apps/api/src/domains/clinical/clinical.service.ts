import { clinicalTransitionAllowed } from '@dentalai/domain';
import type { ClinicalContent } from '@dentalai/contracts';
import { DomainError } from '../../errors/domain-errors.js';

/** Shared application rule, used by the transactional repository, never a test-only copy. */
export function validateClinicalRevision(next: ClinicalContent, prior?: ClinicalContent): void {
  if (next.kind === 'plan') {
    if (new Set(next.items.map((item) => item.currency)).size !== 1)
      throw new DomainError('INVALID_PLAN_CURRENCY', 'A plan must use one explicit currency.', 422);
    next.items.forEach((item, index) => {
      const before = prior?.kind === 'plan' ? prior.items[index] : undefined;
      if (before && before.serviceId === item.serviceId && before.toothCode === item.toothCode) {
        if (!clinicalTransitionAllowed('procedure', before.status, item.status))
          throw new DomainError(
            'INVALID_CLINICAL_TRANSITION',
            'Invalid plan-item status transition.',
            409,
          );
      } else if (item.status !== 'planned')
        throw new DomainError(
          'INVALID_CLINICAL_TRANSITION',
          'New plan items must start planned.',
          422,
        );
    });
  }
  if (
    next.kind === 'demographics' &&
    next.dateOfBirth &&
    next.dateOfBirth > new Date().toISOString().slice(0, 10)
  )
    throw new DomainError('INVALID_BIRTH_DATE', 'Date of birth cannot be in the future.', 422);
  if (!prior) {
    if (
      'status' in next &&
      next.status !==
        (
          {
            finding: 'active',
            allergy: 'active',
            medication: 'active',
            procedure: 'planned',
            plan: 'draft',
          } as Record<string, string>
        )[next.kind]
    )
      throw new DomainError(
        'INVALID_CLINICAL_TRANSITION',
        'Create an initial entry before recording a status transition.',
        422,
      );
    return;
  }
  if (prior.kind !== next.kind)
    throw new DomainError('CLINICAL_CONFLICT', 'A correction must retain its record type.', 409);
  if (
    'status' in prior &&
    'status' in next &&
    !clinicalTransitionAllowed(next.kind, prior.status, next.status)
  )
    throw new DomainError(
      'INVALID_CLINICAL_TRANSITION',
      'This clinical status transition is not allowed.',
      409,
    );
  // A different tooth or code is a documented correction, not an implicit lifecycle change.
}
