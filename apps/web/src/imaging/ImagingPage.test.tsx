// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ImagingPage } from './ImagingPage';
import { apiClient } from '../lib/api-client';
afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(apiClient, 'imagingCapabilities').mockResolvedValue({
    storageConfigured: false,
    inferenceConfigured: false,
    clinicallyValidated: false,
  });
});

describe('experimental private imaging UI', () => {
  it('shows loading/empty states and no validation or fabricated confidence claim', async () => {
    vi.spyOn(apiClient, 'clinicalPatients').mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        givenName: 'Fictional',
        familyName: 'Patient',
        medicalRecordNumber: 'test',
      },
    ]);
    vi.spyOn(apiClient, 'imagingHistory').mockResolvedValue({ images: [], analyses: [] });
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Not clinically validated/)).toBeTruthy();
    await screen.findByText(
      /X-ray inference is unavailable pending technical and clinical validation/,
    );
    await screen.findByRole('option', { name: 'Fictional Patient' });
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    });
    await screen.findByText('No private image studies have been uploaded.');
    expect(screen.queryByText(/Verified/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Upload as new study' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('shows a recoverable directory failure without inventing patients', async () => {
    vi.spyOn(apiClient, 'clinicalPatients').mockRejectedValue(new Error('unavailable'));
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Reload to retry'));
    expect(screen.queryByRole('option', { name: 'Fictional Patient' })).toBeNull();
  });
});
