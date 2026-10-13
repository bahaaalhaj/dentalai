import type { Appointment, AppointmentActionSchema } from '@dentalai/contracts';
import type { z } from 'zod';

export const input = 'w-full p-3 rounded-xl border border-slate-200 bg-slate-50';
export const button = 'px-4 py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50';
export type Modal =
  | { kind: 'book' | 'reschedule'; appointment?: Appointment }
  | {
      kind: 'action';
      appointment: Appointment;
      action: z.infer<typeof AppointmentActionSchema>['action'];
    }
  | { kind: 'history'; appointment: Appointment };
