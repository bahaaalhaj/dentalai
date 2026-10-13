/** Documentation only: the server's live membership queries enforce permissions, never these strings. */
export function authorizationDocumentation(path: string, method: string, isPublic: boolean) {
  if (isPublic)
    return 'Public authentication operation with exact-origin CSRF protection for mutations; registration can create only an unprivileged patient. Verification/reset require valid single-use provider tokens.';
  const tenant =
    'Session-derived active clinic membership; foreign resources are denied. Private/no-store; browser role/clinic/user IDs are never authority. ';
  if (path.includes('/imaging/') || path.includes('/anesthesia/'))
    return (
      tenant +
      'Active dentist role AND active staff/provider required. Imaging scores are advisory and require clinician review. Anesthesia recommendations/confirmation remain disabled without approved rules.'
    );
  if (path.includes('/clinical/'))
    return (
      tenant +
      (path.endsWith('/portal')
        ? 'Patient role and explicitly linked own patient record; approved projection only.'
        : 'Active dentist/provider only; notes/findings require explicit author, version, reason and separate approval.')
    );
  if (path.includes('/billing/')) {
    if (path.endsWith('/portal'))
      return tenant + 'Patient role; explicitly linked own permitted invoices/receipts only.';
    if (/\/(refunds|adjustments|services|prices)$/.test(path))
      return tenant + 'Clinic owner/admin only. Financial history and issued amounts are retained.';
    return (
      tenant +
      (method === 'get'
        ? 'Clinic owner/admin, receptionist or dentist can read authorized clinic financial information.'
        : 'Clinic owner/admin or receptionist can draft/issue invoices or record payments; refunds/adjustments require owner/admin.')
    );
  }
  if (path.includes('/admin/')) {
    if (path.endsWith('/onboarding'))
      return 'Verified authenticated account and explicit authority confirmation create a new isolated clinic. One owned clinic per account; additional clinics require operator review. No browser-supplied owner membership is trusted.';
    if (path.includes('/preferences'))
      return (
        tenant +
        'Any active clinic member can manage only their own notification preference; security invitations cannot be disabled.'
      );
    if (/\/(audit|exports|offboarding|subscription)(\/|$)/.test(path))
      return (
        tenant +
        'Clinic owner only. Export/offboarding also require sign-in within 15 minutes. No automatic historical deletion or provider payment is implied.'
      );
    return (
      tenant +
      'Clinic owner/admin only; role changes cannot elevate the caller or remove the last owner. Admins cannot manage owner/admin membership authority.'
    );
  }
  if (path.includes('/scheduling/') || path.includes('/appointments'))
    return (
      tenant +
      'Patient reads/bookings/cancellation/rescheduling are restricted to linked own records; staff views are clinic-scoped. Confirm/no-show/check-in require staff; start/complete require owner/admin/dentist. Scheduling configuration requires owner/admin. Availability never returns patient identity or complete appointment rows.'
    );
  if (path.includes('/invitations/accept'))
    return 'Verified invited email holder with a valid unexpired invitation; invitation-derived clinic/role only.';
  if (path.includes('/invitations'))
    return (
      tenant +
      'Clinic owner/admin can invite clinic_admin, dentist or receptionist. Invitations cannot create owners. Staff authority never comes from public registration.'
    );
  if (path.includes('/patients/'))
    return (
      tenant +
      'Clinic staff can read tenant patient identity; patients can read only explicitly linked own identity.'
    );
  return 'Verified authenticated account. Sessions and membership selection are restricted to the caller; clinic routes additionally require live active membership. No session token is returned in API DTOs.';
}
