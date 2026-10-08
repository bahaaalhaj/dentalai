import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => {
    throw new Error('Network access is disabled in unit tests.');
  }),
);
