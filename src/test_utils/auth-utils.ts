import { supabase } from '../lib/supabase';

export async function performLogin(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'An unknown error occurred' };
  }
}

export async function performRegister(
  email: string, 
  password: string, 
  fullName: string, 
  phone: string
) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { 
          full_name: fullName, 
          role: 'patient',
          phone: phone
        }
      }
    });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'An unknown error occurred' };
  }
}


