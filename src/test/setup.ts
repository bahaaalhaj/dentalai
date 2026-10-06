import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => {
  const createQueryBuilder = () => {
    const builder = {
      select: vi.fn(),
      insert: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };

    for (const method of [
      builder.select,
      builder.insert,
      builder.upsert,
      builder.update,
      builder.delete,
      builder.eq,
      builder.order,
      builder.limit,
    ]) {
      method.mockReturnValue(builder);
    }

    return builder;
  };

  return {
    supabaseMock: {
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: null,
          error: { message: 'Test Supabase authentication is disabled.' },
        })),
        signUp: vi.fn(async () => ({
          data: null,
          error: { message: 'Test Supabase authentication is disabled.' },
        })),
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signOut: vi.fn(async () => ({ error: null })),
      },
      from: vi.fn(() => createQueryBuilder()),
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

vi.stubGlobal(
  'fetch',
  vi.fn(async () => {
    throw new Error('Network access is disabled in unit tests.');
  }),
);
