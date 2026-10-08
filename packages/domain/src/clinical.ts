/** FDI / ISO 3950 two-digit notation. Never infer a finding from an unrecorded tooth. */
export function toothProblem(
  tooth: string | null,
  surfaces: readonly string[],
): string | undefined {
  if (tooth === null) return surfaces.length ? 'Surfaces require a tooth.' : undefined;
  if (!/^(?:[1-4][1-8]|[5-8][1-5])$/.test(tooth)) return 'Select a valid FDI tooth.';
  const anterior = Number(tooth[1]) <= 3;
  if (new Set(surfaces).size !== surfaces.length) return 'Duplicate surfaces are not allowed.';
  if (surfaces.some((surface) => !['M', 'D', 'B', 'F', 'L', 'O', 'I'].includes(surface)))
    return 'Unknown tooth surface.';
  if (
    surfaces.some((surface) =>
      anterior ? ['O', 'B'].includes(surface) : ['I', 'F'].includes(surface),
    )
  )
    return 'Use I/F for anterior teeth and O/B for posterior teeth.';
  return undefined;
}

const transitions: Record<string, Record<string, readonly string[]>> = {
  finding: {
    active: ['resolved', 'entered_in_error'],
    resolved: ['active', 'entered_in_error'],
    entered_in_error: [],
  },
  procedure: {
    planned: ['in_progress', 'completed', 'cancelled', 'entered_in_error'],
    in_progress: ['completed', 'cancelled', 'entered_in_error'],
    completed: ['entered_in_error'],
    cancelled: ['entered_in_error'],
    entered_in_error: [],
  },
  plan: {
    draft: ['presented', 'cancelled'],
    presented: ['accepted', 'rejected', 'cancelled'],
    accepted: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    rejected: [],
    cancelled: [],
  },
  allergy: {
    active: ['inactive', 'resolved', 'entered_in_error'],
    inactive: ['active', 'resolved', 'entered_in_error'],
    resolved: ['active', 'entered_in_error'],
    entered_in_error: [],
  },
  medication: {
    active: ['stopped', 'completed', 'entered_in_error'],
    stopped: ['active', 'entered_in_error'],
    completed: ['entered_in_error'],
    entered_in_error: [],
  },
};
export function clinicalTransitionAllowed(kind: string, before: string, after: string): boolean {
  return before === after || (transitions[kind]?.[before]?.includes(after) ?? false);
}
