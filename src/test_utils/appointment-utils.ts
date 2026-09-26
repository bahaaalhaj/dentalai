import { supabase } from '../lib/supabase';

export const TIME_SLOTS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"
];

/**
 * Fetches booked time slots for a specific date
 */
export async function fetchBookedSlots(date: string) {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('time')
      .eq('date', date);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    // Normalize to HH:mm
    const times = data?.map(appt => appt.time.slice(0, 5)) || [];
    return { success: true, data: times };
  } catch (err: any) {
    return { success: false, error: err.message || 'An unknown error occurred' };
  }
}

export function getAvailableSlots(allSlots: string[], bookedSlots: string[]): string[] {
  return allSlots.filter(slot => !bookedSlots.includes(slot));
}
/**
 * Attempts to book an appointment after checking availability
 */
export async function bookAppointment(
  patientId: string,
  date: string,
  time: string
) {
  try {
    // 1. Double check availability
    const { data: existing } = await supabase
      .from('appointments')
      .select('id')
      .eq('date', date)
      .eq('time', time)
      .single();

    if (existing) {
      return { success: false, error: 'This time slot is already booked.' };
    }

    // 2. Perform booking
    const { data, error } = await supabase.from('appointments').insert([
      {
        patient_id: patientId,
        date: date,
        time: time,
        status: 'booked',
        confirmation_status: 'pending'
      }
    ]).select();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data?.[0] };
  } catch (err: any) {
    return { success: false, error: err.message || 'An unknown error occurred' };
  }
}
export async function cancelAppointment(appointmentId: string) {
  try {
    // Check if it exists first
    const { data: existing, error: fetchError } = await supabase
      .from('appointments')
      .select('id')
      .eq('id', appointmentId)
      .single();

    if (fetchError || !existing) {
      return { success: false, error: 'Appointment not found.' };
    }

    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', appointmentId);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'An unknown error occurred' };
  }
}

