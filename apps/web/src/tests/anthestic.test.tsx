// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnestheticCalculator } from '../components/AnestheticCalculator';

const { insert } = vi.hoisted(() => ({ insert: vi.fn(async () => ({ error: null })) }));
vi.mock('../lib/feature-flags', () => ({
  clinicalFeatureFlags: { anestheticDecisionSupport: true },
  CLINICAL_FEATURE_UNAVAILABLE_MESSAGE: 'Unavailable pending validation.',
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        insert,
      };
      return builder;
    },
  },
}));
afterEach(cleanup);

async function enter(age: string, weight: string, bp: string) {
  await act(async () => {
    render(<AnestheticCalculator patientId="fictional-demo-only" />);
  });
  fireEvent.change(screen.getByPlaceholderText('35'), { target: { value: age } });
  fireEvent.change(screen.getByPlaceholderText('75'), { target: { value: weight } });
  fireEvent.change(screen.getByPlaceholderText('120/80'), { target: { value: bp } });
  fireEvent.click(screen.getByRole('button', { name: /generate experimental estimate/i }));
}
describe('actual experimental calculator, not a test-only formula copy', () => {
  it.each([
    ['-5', '70', '120/80'],
    ['30', '-10', '120/80'],
    ['', '70', '120/80'],
    ['30', '', '120/80'],
    ['0', '70', '120/80'],
    ['30', '0', '120/80'],
    ['30', '70', ''],
    ['30', '70', 'invalid'],
    ['30', '70', '120/0'],
    ['30', '1e308', '120/80'],
    ['30', '70', `${'9'.repeat(400)}/80`],
  ])(
    'rejects invalid age=%s weight=%s BP=%s without persisting a result',
    async (age, weight, bp) => {
      await enter(age, weight, bp);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByText('Modeled Dose Estimate')).toBeNull();
      expect(insert).not.toHaveBeenCalled();
    },
  );
  it('preserves the existing demo arithmetic and explicitly labels its unvalidated output', async () => {
    await enter('30', '70', '120/80');
    await waitFor(() => expect(insert).toHaveBeenCalledOnce());
    expect(screen.getByText('343 mg')).toBeInTheDocument();
    expect(screen.getByText(/must not be used for patient-care decisions/i)).toBeInTheDocument();
  });
});
