import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage:
    typeof window !== 'undefined'
    ? window.sessionStorage
    : undefined,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export type UserRole = 'patient' | 'doctor';

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

export interface ToothStatus {
  [key: string]: 'healthy' | 'filling' | 'root_canal' | 'extracted' | 'crown' | 'implant' | 'cavity';
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
