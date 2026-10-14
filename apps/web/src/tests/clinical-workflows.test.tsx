// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ClinicalRecordEditor } from '../clinical/ClinicalRecordEditor';
import { PatientClinicalHistory } from '../clinical/PatientClinicalHistory';
import { Odontogram } from '../clinical/Odontogram';
import { ClinicianPatientsPage } from '../clinical/ClinicianPatientsPage';
import type { ClinicalRecord, ClinicalWorkspace } from '@dentalai/contracts';
const mocks = vi.hoisted(() => ({
  portal: vi.fn(),
  patients: vi.fn(),
  workspace: vi.fn(),
  write: vi.fn(),
}));
vi.mock('../lib/api-client', () => ({
  apiClient: {
    clinicalPortal: mocks.portal,
    clinicalPatients: mocks.patients,
    clinicalWorkspace: mocks.workspace,
    writeClinicalRecord: mocks.write,
  },
}));
const workspace: ClinicalWorkspace = {
  patient: {
    id: crypto.randomUUID(),
    givenName: 'Fictional',
    familyName: 'Patient',
    medicalRecordNumber: 'Fictional',
  },
  encounters: [],
  records: [],
  history: [],
  legacyRecords: [],
  services: [],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('actual clinical UI modules', () => {
  it('labels a prefilled correction textarea without including its existing clinical text', () => {
    const correction: ClinicalRecord = {
      id: crypto.randomUUID(),
      groupId: crypto.randomUUID(),
      encounterId: crypto.randomUUID(),
      version: 1,
      authorName: 'Fictional Dentist',
      recordedAt: new Date().toISOString(),
      reason: 'Fictional reason',
      approval: 'approved',
      approvedAt: new Date().toISOString(),
      reviewReason: 'Fictional review',
      data: { kind: 'note', noteType: 'progress', body: 'Fictional prefilled note' },
    };
    render(
      <ClinicalRecordEditor
        workspace={workspace}
        encounterId={crypto.randomUUID()}
        correction={correction}
        tooth={undefined}
        onSave={vi.fn()}
        cancel={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText('Clinical note', { exact: true }) as HTMLTextAreaElement).value,
    ).toBe('Fictional prefilled note');
  });
  it('does not replace a newly selected patient with an older save response', async () => {
    const otherPatient = { ...workspace.patient, id: crypto.randomUUID(), familyName: 'Other' };
    const encounterId = crypto.randomUUID();
    const firstWorkspace: ClinicalWorkspace = {
      ...workspace,
      encounters: [
        {
          id: encounterId,
          status: 'open',
          startedAt: new Date().toISOString(),
          endedAt: null,
          authorName: 'Fictional Dentist',
        },
      ],
    };
    mocks.patients.mockResolvedValue([workspace.patient, otherPatient]);
    mocks.workspace.mockImplementation(async (id: string) =>
      id === workspace.patient.id ? firstWorkspace : { ...workspace, patient: otherPatient },
    );
    let complete!: () => void;
    mocks.write.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    render(
      <MemoryRouter>
        <ClinicianPatientsPage />
      </MemoryRouter>,
    );
    await screen.findByRole('option', { name: /Fictional Patient/ });
    fireEvent.change(screen.getByLabelText('Patient', { exact: true }), {
      target: { value: workspace.patient.id },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add clinical entry' }));
    fireEvent.change(screen.getByLabelText('Clinical note'), {
      target: { value: 'Fictional pending save' },
    });
    fireEvent.change(screen.getByLabelText('Clinical change reason'), {
      target: { value: 'Fictional test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Patient', { exact: true }), {
      target: { value: otherPatient.id },
    });
    await screen.findByRole('heading', { name: 'Fictional Other' });
    await act(async () => {
      complete();
    });
    expect(screen.getByRole('heading', { name: 'Fictional Other' })).toBeTruthy();
    expect(mocks.workspace.mock.calls.map((call) => call[0])).toEqual([
      workspace.patient.id,
      otherPatient.id,
    ]);
    expect(screen.queryByText('Draft saved. Approval is still required.')).toBeNull();
  });
  it('keeps the patient selector accessible by its label when options are populated', async () => {
    mocks.patients.mockResolvedValueOnce([workspace.patient]);
    render(
      <MemoryRouter>
        <ClinicianPatientsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('option', { name: /Fictional Patient/ })).toBeTruthy();
    expect(screen.getByLabelText('Patient', { exact: true }).tagName).toBe('SELECT');
  });
  it('requires an explicit finding action rather than saving a preselected condition', async () => {
    const save = vi.fn();
    render(
      <ClinicalRecordEditor
        workspace={workspace}
        encounterId={crypto.randomUUID()}
        correction={null}
        tooth="16"
        onSave={save}
        cancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Finding action') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Clinical change reason'), {
      target: { value: 'Fictional reason' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Clinical entry' }));
    expect((await screen.findByRole('alert')).textContent).toContain('explicit');
    expect(save).not.toHaveBeenCalled();
  });
  it('selects a tooth without producing a finding and never labels unknown teeth healthy', () => {
    const select = vi.fn();
    render(<Odontogram records={[]} select={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tooth 16: unrecorded' }));
    expect(select).toHaveBeenCalledWith('16');
    expect(
      screen.getByRole('button', { name: 'Tooth 16: unrecorded' }).getAttribute('data-state'),
    ).toBe('unknown');
    expect(
      screen.getByText('No finding or procedure is recorded for this tooth in this view.'),
    ).toBeTruthy();
  });
  it('validates explicit tooth and surfaces before sending a draft', async () => {
    const save = vi.fn();
    render(
      <ClinicalRecordEditor
        workspace={workspace}
        encounterId={crypto.randomUUID()}
        correction={null}
        tooth="16"
        onSave={save}
        cancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('FDI tooth number'), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('Finding action'), { target: { value: 'caries' } });
    fireEvent.change(screen.getByLabelText('Clinical change reason'), {
      target: { value: 'Fictional reason' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Clinical entry' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('FDI tooth number'), { target: { value: '16' } });
    fireEvent.click(screen.getByLabelText('O'));
    fireEvent.submit(screen.getByRole('form', { name: 'Clinical entry' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'finding', toothCode: '16', surfaces: ['O'] }),
          reason: 'Fictional reason',
        }),
      ),
    );
  });
  it('keeps entered clinical text when a recoverable conflict occurs', async () => {
    const save = vi
      .fn()
      .mockRejectedValue(new Error('The record changed. Refresh before retrying.'));
    render(
      <ClinicalRecordEditor
        workspace={workspace}
        encounterId={crypto.randomUUID()}
        correction={null}
        tooth={undefined}
        onSave={save}
        cancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Clinical note'), {
      target: { value: 'Fictional retained draft' },
    });
    fireEvent.change(screen.getByLabelText('Clinical change reason'), {
      target: { value: 'Fictional correction' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Clinical entry' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'operation could not be completed',
    );
    expect((screen.getByLabelText('Clinical note') as HTMLTextAreaElement).value).toBe(
      'Fictional retained draft',
    );
  });
  it('shows portal loading, empty, recoverable error and approved read-only states', async () => {
    mocks.portal
      .mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce({ records: [], history: [] });
    render(
      <MemoryRouter>
        <PatientClinicalHistory />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'operation could not be completed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByText('No approved clinical information is available yet.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });
});
