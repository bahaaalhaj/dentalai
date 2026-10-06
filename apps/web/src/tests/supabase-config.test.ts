import { describe, expect, it } from 'vitest';
import { readSupabaseConfig, SupabaseConfigurationError } from '../lib/supabase-config';

describe('Supabase configuration', () => {
  it('fails clearly when browser configuration is missing', () => {
    expect(() => readSupabaseConfig({})).toThrowError(SupabaseConfigurationError);
    expect(() => readSupabaseConfig({})).toThrow(
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY',
    );
  });

  it('rejects malformed URLs before creating a client', () => {
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'not-a-url',
        VITE_SUPABASE_ANON_KEY: 'test-key',
      }),
    ).toThrow('VITE_SUPABASE_URL must be a valid HTTP(S) URL.');
  });

  it('normalizes a valid local configuration without contacting Supabase', () => {
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321/',
        VITE_SUPABASE_ANON_KEY: 'test-key',
      }),
    ).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'test-key',
    });
  });
});
