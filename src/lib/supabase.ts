import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from './supabase-config';

const { url: supabaseUrl, anonKey: supabaseAnonKey } = readSupabaseConfig(import.meta.env);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type UserRole = 'patient' | 'doctor';
export type ToothCondition =
  'healthy' | 'filling' | 'root_canal' | 'extracted' | 'crown' | 'implant' | 'cavity';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone?: string;
  created_at: string;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  date: string;
  time: string;
  status: 'booked' | 'cancelled' | 'completed';
  confirmation_status: 'pending' | 'confirmed';
  notes?: string;
}

export type ToothStatus = Record<string, ToothCondition>;

export interface XrayImage {
  id: string;
  patient_id: string;
  image_url: string;
  ai_report?: unknown;
  created_at: string;
}

export interface ProcedurePrice {
  procedure_name: string;
  price_sp: number;
  updated_at: string;
}

export interface Payment {
  id: string;
  patient_id: string;
  amount_sp: number;
  notes?: string;
  created_at: string;
}

export interface MedicalRecord {
  id: string;
  patient_id: string;
  medical_history: string;
  teeth_status: ToothStatus;
  updated_at: string;
}
