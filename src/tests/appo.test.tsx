import { describe, it, expect, vi } from 'vitest';
import { getAvailableSlots, fetchBookedSlots, TIME_SLOTS , bookAppointment ,cancelAppointment} from '../test_utils/appointment-utils';
import { supabase } from '../lib/supabase';

/**
 * APPOINTMENT VIEWING TESTS
 * Testing the logic for calculating available slots
 */

describe('Appointment Availability Logic', () => {
    const bookedSlots = ["09:00", "10:30", "14:00"];
    
  it('should return all slots if none are booked', () => {
    const availableSlots = getAvailableSlots(TIME_SLOTS, []);
    expect(availableSlots.length).toBe(TIME_SLOTS.length);
  });

  it('should return error when booking a slot that is already taken', async () => {
    // 1. Arrange: Mock supabase to return an existing appointment
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'existing-id' }, error: null });
    const mockEqTime = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEqDate = vi.fn().mockReturnValue({ eq: mockEqTime });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqDate });
    
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: mockSelect
    } as any);

    // 2. Act: Attempt to book
    const result = await bookAppointment('user-1', '2026-05-01', '10:00');

    // 3. Assert: Result should be failure with specific error message
    expect(result.success).toBe(false);
    expect(result.error).toBe('This time slot is already booked.');
    
    // Cleanup mocks
    vi.restoreAllMocks();
  });

it('should return error when cancelling an appointment that does not exist', async () => {
    // 1. Arrange: Mock supabase to return null (not found)
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: mockSelect
    } as any);

    // 2. Act: Attempt to cancel
    const result = await cancelAppointment('non-existent-id');

    // 3. Assert: Result should be failure
    expect(result.success).toBe(false);
    expect(result.error).toBe('Appointment not found.');
    
    vi.restoreAllMocks();
    });
});
