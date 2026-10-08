import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from './supabase-config';

const { url: supabaseUrl, anonKey: supabaseAnonKey } = readSupabaseConfig(import.meta.env);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export type UserRole = 'patient' | 'doctor';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone?: string;
  created_at: string;
}

export interface XrayImage {
  id: string;
  patient_id: string;
  image_url: string;
  ai_report?: unknown;
  created_at: string;
}
