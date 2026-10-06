export interface SupabaseEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigurationError';
  }
}

export function readSupabaseConfig(env: SupabaseEnvironment): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    throw new SupabaseConfigurationError(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.',
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL must be a valid HTTP(S) URL.');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL must use HTTP or HTTPS.');
  }

  return { url: parsedUrl.toString().replace(/\/$/, ''), anonKey };
}
