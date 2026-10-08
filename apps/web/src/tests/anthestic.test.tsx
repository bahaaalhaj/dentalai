// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnestheticCalculator } from '../components/AnestheticCalculator';
vi.mock('../lib/feature-flags', () => ({
  clinicalFeatureFlags: { anestheticDecisionSupport: true },
  CLINICAL_FEATURE_UNAVAILABLE_MESSAGE: 'Unavailable pending validation.',
}));
afterEach(cleanup);
it('cannot bypass unapproved references with a development flag', () => {
  render(<AnestheticCalculator patientId="fictional-only" />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Recommendations and clinician confirmation are disabled',
  );
  expect(screen.getByText(/dentist remains responsible/i)).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText(/\d+ mg/)).toBeNull();
});
