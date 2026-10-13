/** Conservative policy check, supplemented by AWS policy-status/BPA controls. */
export function assertNonPublicPolicy(policy: string | undefined): void {
  if (!policy) return;
  const document: unknown = JSON.parse(policy);
  if (!document || typeof document !== 'object' || !('Statement' in document))
    throw new Error('Invalid private bucket policy');
  const statements = Array.isArray(document.Statement) ? document.Statement : [document.Statement];
  for (const statement of statements) {
    if (!statement || typeof statement !== 'object') throw new Error('Invalid policy statement');
    if (statement.Effect === 'Deny') continue;
    if (statement.Effect !== 'Allow' || 'NotPrincipal' in statement)
      throw new Error('Unverifiable bucket policy');
    const principal: unknown = statement.Principal;
    const values =
      typeof principal === 'string'
        ? [principal]
        : principal && typeof principal === 'object'
          ? Object.values(principal).flat()
          : [];
    if (!values.length || values.some((value) => typeof value !== 'string' || value.includes('*')))
      throw new Error('Public or anonymous policy grant prohibited');
  }
}
