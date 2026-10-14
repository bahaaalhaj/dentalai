// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AuthIdentity, ClinicRole } from '@dentalai/contracts';
import { AppShell } from '../shell/AppShell';
import { workspaceNavigation } from '../shell/navigation';
import { Odontogram } from '../clinical/Odontogram';
import { SectionTabs } from '../ui/SectionTabs';
import { PrivatePreview } from '../imaging/PrivatePreview';
import { UploadDropZone } from '../imaging/UploadDropZone';
import { setLocale, t } from '../i18n';

afterEach(() => {
  cleanup();
  setLocale('en', false);
  vi.restoreAllMocks();
});
const identity = (roles: ClinicRole[]): AuthIdentity => {
  const membership = {
    id: crypto.randomUUID(),
    clinicId: crypto.randomUUID(),
    clinicName: 'Fictional clinic',
    roles,
  };
  return {
    user: {
      id: crypto.randomUUID(),
      name: 'Fictional user',
      email: 'fictional@example.test',
      emailVerified: true,
    },
    accountRole: 'patient',
    memberships: [membership],
    activeMembership: membership,
  };
};
describe('Phase 17 workspace presentation', () => {
  it.each(['clinic_owner', 'clinic_admin', 'dentist', 'receptionist', 'patient'] as const)(
    'uses actual %s membership for navigation',
    (role) => {
      const links = workspaceNavigation([role], true).map((item) => item.to);
      expect(links).toContain('/appointments');
      expect(links.includes('/imaging')).toBe(role === 'dentist');
      expect(links.includes('/administration')).toBe(
        ['clinic_owner', 'clinic_admin'].includes(role),
      );
      expect(links.includes('/administration?tab=operations')).toBe(role === 'clinic_owner');
      expect(links.includes('/billing/portal')).toBe(role === 'patient');
      expect(links.includes('/patients')).toBe(role !== 'patient');
    },
  );
  it('offers only account access without clinic membership', () => {
    expect(workspaceNavigation([], false).map((item) => item.to)).toEqual([
      '/dashboard',
      '/dashboard#account',
    ]);
  });
  it('opens and closes accessible mobile navigation without granting a patient clinician actions', async () => {
    render(
      <MemoryRouter>
        <AppShell identity={identity(['patient'])} refresh={async () => undefined}>
          <main>
            <h1>Fixture workspace</h1>
          </main>
        </AppShell>
      </MemoryRouter>,
    );
    const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).queryByRole('link', { name: 'Imaging' })).toBeNull();
    fireEvent.click(within(drawer).getByRole('link', { name: 'Approved clinical history' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'Skip to workspace' }).getAttribute('href')).toBe(
      '#workspace-content',
    );
    if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });
  it('localizes shell navigation and document direction in Arabic', () => {
    setLocale('ar', false);
    render(
      <MemoryRouter>
        <AppShell identity={identity(['dentist'])} refresh={async () => undefined}>
          <main />
        </AppShell>
      </MemoryRouter>,
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('link', { name: t('polish.chart') })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: t('polish.account') })).toHaveLength(2);
  });
  it('renders all 52 SVG FDI teeth with anatomical order and roving keyboard focus', async () => {
    const select = vi.fn();
    render(<Odontogram records={[]} select={select} />);
    const teeth = screen.getAllByRole('button');
    expect(teeth).toHaveLength(52);
    expect(teeth.every((tooth) => tooth.querySelector('svg'))).toBe(true);
    expect(
      teeth.slice(0, 16).map((tooth) => tooth.querySelector('.tooth-number')?.textContent),
    ).toEqual([
      '18',
      '17',
      '16',
      '15',
      '14',
      '13',
      '12',
      '11',
      '21',
      '22',
      '23',
      '24',
      '25',
      '26',
      '27',
      '28',
    ]);
    const first = screen.getByLabelText('Tooth 18: unrecorded');
    await act(async () => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByLabelText('Tooth 17: unrecorded'));
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Tooth 16: unrecorded'));
    expect(select).toHaveBeenCalledExactlyOnceWith('16');
    expect(screen.getByLabelText('Tooth 16: unrecorded').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });
  it('marks health only for an actual approved active healthy finding, not a pending entry', () => {
    const data = {
      kind: 'finding' as const,
      toothCode: '11',
      surfaces: [],
      findingCode: 'healthy' as const,
      status: 'active' as const,
      details: null,
    };
    const { rerender } = render(<Odontogram records={[{ data, approval: 'pending' }]} />);
    let tooth = screen.getByLabelText('Tooth 11: healthy');
    expect(tooth.getAttribute('data-state')).toBe('pending');
    expect(tooth.querySelector('path[stroke="#2b8b75"]')).toBeNull();
    rerender(<Odontogram records={[{ data, approval: 'approved' }]} />);
    tooth = screen.getByLabelText('Tooth 11: healthy');
    expect(tooth.querySelector('path[stroke="#2b8b75"]')).toBeTruthy();
    expect(screen.getByLabelText('Tooth 12: unrecorded').getAttribute('data-state')).toBe(
      'unknown',
    );
  });
  it('keeps anatomical arrow direction LTR in Arabic, while tabs use RTL navigation', async () => {
    setLocale('ar', false);
    render(<Odontogram records={[]} />);
    const first = screen.getAllByRole('button')[0]!;
    await act(async () => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toContain('17');
    expect(first.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
    cleanup();
    const change = vi.fn();
    render(
      <SectionTabs
        active="a"
        change={change}
        label="Fixture"
        tabs={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
      >
        Fixture
      </SectionTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowLeft' });
    expect(change).toHaveBeenCalledWith('b');
  });
  it('uses only authenticated image endpoints and provides a recoverable failed preview', () => {
    render(<PrivatePreview id="fixture-image" version={2} />);
    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toBe('/api/v1/imaging/images/fixture-image/content');
    fireEvent.error(image);
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('img')).toBeTruthy();
  });
  it('rejects malformed selected files without previewing them or inventing upload progress', () => {
    const choose = vi.fn(),
      reject = vi.fn();
    render(<UploadDropZone file={undefined} busy={false} choose={choose} reject={reject} />);
    fireEvent.change(screen.getByLabelText('PNG/JPEG image (maximum 10 MiB)'), {
      target: { files: [new File(['bad'], 'malicious.svg', { type: 'image/svg+xml' })] },
    });
    expect(reject).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.change(screen.getByLabelText('PNG/JPEG image (maximum 10 MiB)'), {
      target: { files: [new File(['fixture'], 'synthetic.png', { type: 'image/png' })] },
    });
    expect(choose).toHaveBeenLastCalledWith(expect.any(File));
  });
});
