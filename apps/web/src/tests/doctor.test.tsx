// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Odontogram } from '../clinical/Odontogram';
afterEach(cleanup);
describe('production odontogram projection', () => {
  it('does not collapse procedures into findings or infer health', () => {
    render(
      <Odontogram
        records={[
          {
            data: {
              kind: 'procedure',
              toothCode: '16',
              surfaces: ['O'],
              procedureCode: 'restoration',
              description: 'Fictional completed procedure',
              status: 'completed',
            },
          },
          {
            data: {
              kind: 'finding',
              toothCode: '11',
              surfaces: ['I'],
              findingCode: 'fracture',
              status: 'active',
              details: null,
            },
          },
        ]}
      />,
    );
    expect(screen.getByLabelText('Tooth 16: unrecorded')).toBeTruthy();
    expect(screen.getByLabelText('Tooth 11: fracture')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
