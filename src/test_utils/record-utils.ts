import { supabase } from '../lib/supabase';

export async function checkPatientExists(patientId: string) {
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', patientId)
      .eq('role', 'patient') // ✅ ensure it's a patient
      .maybeSingle(); // ✅ safer than single()

    if (error) {
      return { exists: false, error: error.message };
    }

    return { exists: !!data }; // true if found, false if not
  } catch (err: any) {
    return {
      exists: false,
      error: err.message || 'Unknown error',
    };
  }
}
export async function CreateMedicalRecord(patientId: string) {
  if (!patientId) {
    return { success: false, error: 'Patient ID is required' };
  }

  try {
    // ✅ FIX 1: await the check
    const check = await checkPatientExists(patientId);

    if (!check.exists) {
      return { success: false, error: 'Patient does not exist' };
    }

    // ✅ Create or update record
    const { data, error } = await supabase
      .from('medical_records')
      .upsert(
        {
          patient_id: patientId,
          updated_at: new Date().toISOString(), // ✅ correct column
        },
        {
          onConflict: 'patient_id',
        }
      )
      .select();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data?.[0] };

  } catch (err: any) {
    console.error('Error creating medical record:', err);
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}



