// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AuthIdentity, ClinicRole } from '@dentalai/contracts';
import { DashboardPage } from '../dashboard/DashboardPage';
// Resolve the real lazy chart before assertions; slow Windows disk imports are not UI timeouts.
import '../dashboard/AppointmentDistribution';
import { PatientsDirectory } from '../dashboard/PatientsDirectory';
import { apiClient } from '../lib/api-client';
import { setLocale } from '../i18n';
const api = vi.hoisted(() => ({
  schedulingCatalog: vi.fn(),
  appointments: vi.fn(),
  clinicalPatients: vi.fn(),
  billingCatalog: vi.fn(),
  billingReports: vi.fn(),
  administration: vi.fn(),
  clinicalPortal: vi.fn(),
  administrationAudit: vi.fn(),
}));
vi.mock('../lib/api-client', () => ({ apiClient: api }));
const patient = {
  id: crypto.randomUUID(),
  givenName: 'Synthetic',
  familyName: 'Example',
  medicalRecordNumber: 'DEMO-01',
};
function identity(role: ClinicRole): AuthIdentity {
  const membership = {
    id: crypto.randomUUID(),
    clinicId: crypto.randomUUID(),
    clinicName: 'Fictional clinic',
    roles: [role],
  };
  return {
    user: {
      id: crypto.randomUUID(),
      name: 'Fictional',
      email: 'fixture@example.test',
      emailVerified: true,
    },
    accountRole: 'patient',
    memberships: [membership],
    activeMembership: membership,
  };
}
beforeEach(() => {
  api.schedulingCatalog.mockResolvedValue({ clinicTimezone: 'Asia/Baghdad' });
  api.appointments.mockResolvedValue({ items: [], nextOffset: null });
  api.clinicalPatients.mockResolvedValue([patient]);
  api.billingCatalog.mockResolvedValue({ patients: [patient] });
  api.billingReports.mockResolvedValue([
    {
      currency: 'USD',
      invoiceCount: 1,
      issuedMinor: 10000,
      adjustmentMinor: 0,
      paymentsMinor: 2500,
      refundsMinor: 0,
      balanceMinor: 7500,
    },
  ]);
  api.clinicalPortal.mockResolvedValue({ records: [], history: [] });
  api.administrationAudit.mockResolvedValue([
    {
      id: crypto.randomUUID(),
      actorName: 'Fictional owner',
      action: 'fixture.created',
      occurredAt: new Date().toISOString(),
    },
  ]);
  api.administration.mockResolvedValue({
    usage: { seats: 2, appointments: 1 },
    subscription: { effectiveState: 'trial', limits: { seats: 5, appointments: 100 } },
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  setLocale('en', false);
});
it.each(['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'] as const)(
  'renders real-data %s overview and calls only permitted APIs',
  async (role) => {
    render(
      <MemoryRouter>
        <DashboardPage identity={identity(role)} refresh={async () => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await screen.findByRole('heading', { name: 'Quick actions' });
    expect(screen.getByText(/loaded API pages/)).toBeTruthy();
    expect(screen.getByText('No appointments in this view')).toBeTruthy();
    await screen.findByText('No appointment data to chart yet.');
    if (role === 'patient') {
      expect(apiClient.billingReports).not.toHaveBeenCalled();
      expect(apiClient.clinicalPatients).not.toHaveBeenCalled();
      expect(apiClient.clinicalPortal).toHaveBeenCalledOnce();
      expect(screen.queryByRole('link', { name: 'Clinical patients' })).toBeNull();
    } else {
      expect(apiClient.billingReports).toHaveBeenCalledOnce();
      expect(screen.getByText('$25.00')).toBeTruthy();
    }
    expect(apiClient.administrationAudit).toHaveBeenCalledTimes(role === 'clinic_owner' ? 1 : 0);
    expect(apiClient.administration).toHaveBeenCalledTimes(
      ['clinic_owner', 'clinic_admin'].includes(role) ? 1 : 0,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
    await waitFor(() => expect(apiClient.schedulingCatalog).toHaveBeenCalledTimes(2));
  },
);
it('shows an error instead of fabricated zero statistics and supports retry', async () => {
  api.schedulingCatalog.mockRejectedValueOnce(new Error('unavailable'));
  render(
    <MemoryRouter>
      <DashboardPage identity={identity('dentist')} refresh={async () => undefined} />
    </MemoryRouter>,
  );
  await screen.findByRole('alert');
  expect(screen.queryByText('Accessible patient records')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'Quick actions' });
});
it('filters the permitted directory and links dentists to an explicit patient context', async () => {
  render(
    <MemoryRouter>
      <PatientsDirectory identity={identity('dentist')} />
    </MemoryRouter>,
  );
  await screen.findByText('Synthetic Example');
  expect(
    screen.getByRole('link', { name: 'Open clinical workspace' }).getAttribute('href'),
  ).toContain(patient.id);
  fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'no match' } });
  expect(screen.getByText('No matching patient records')).toBeTruthy();
});
it('retries directory failures without exposing clinician actions to a receptionist', async () => {
  api.billingCatalog.mockRejectedValueOnce(new Error('unavailable'));
  render(
    <MemoryRouter>
      <PatientsDirectory identity={identity('receptionist')} />
    </MemoryRouter>,
  );
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Synthetic Example');
  expect(screen.queryByRole('link', { name: 'Open clinical workspace' })).toBeNull();
});
