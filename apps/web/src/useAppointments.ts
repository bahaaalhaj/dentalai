import { useEffect, useState, useCallback } from 'react';
import { clinicToday } from '@dentalai/domain';
import type {
  AuthIdentity,
  Appointment,
  SchedulingCatalog,
  SlotSchema,
  AppointmentHistorySchema,
} from '@dentalai/contracts';
import type { z } from 'zod';
import { apiClient } from './lib/api-client';
import { getErrorMessage } from './lib/errors';
import { t } from './i18n';
import { Modal } from './appointment-shared';

export function useAppointments(identity: AuthIdentity) {
  const [catalog, setCatalog] = useState<SchedulingCatalog | null>(null);
  const [items, setItems] = useState<Appointment[]>([]);
  const [view, setView] = useState<'upcoming' | 'history'>('upcoming');
  const [calendarDate, setCalendarDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [type, setType] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<z.infer<typeof SlotSchema>[]>([]);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [patientId, setPatientId] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<z.infer<typeof AppointmentHistorySchema>>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const roles = identity.activeMembership?.roles ?? [];
  const staff = roles.some((role) => role !== 'patient');
  const admin = roles.some((role) => role === 'clinic_owner' || role === 'clinic_admin');
  const clinicalStaff = roles.some(
    (role) => role === 'dentist' || role === 'clinic_owner' || role === 'clinic_admin',
  );
  const refresh = useCallback(async () => {
    const result = await apiClient.appointments({
      view,
      offset,
      ...(calendarDate ? { date: calendarDate } : {}),
    });
    setItems(result.items);
    setNextOffset(result.nextOffset);
  }, [view, offset, calendarDate]);
  useEffect(() => {
    let active = true;
    apiClient
      .schedulingCatalog()
      .then((value) => {
        if (!active) return;
        setCatalog(value);
        setLocation(value.locations[0]?.id ?? '');
        setType(value.types[0]?.id ?? '');
        setDate(clinicToday(value.locations[0]?.timezone ?? value.clinicTimezone));
      })
      .catch((err: unknown) => {
        if (active) setError(getErrorMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    apiClient
      .appointments({ view, offset, ...(calendarDate ? { date: calendarDate } : {}) })
      .then((result) => {
        if (active) {
          setItems(result.items);
          setNextOffset(result.nextOffset);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(getErrorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [view, offset, calendarDate]);
  const run = async (operation: () => Promise<unknown>, success: string, close = false) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      setNotification(success);
      if (close) setModal(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const timezone =
    catalog?.locations.find((item) => item.id === location)?.timezone ??
    catalog?.clinicTimezone ??
    'Etc/UTC';
  function clearOffers() {
    setSlots([]);
    setAvailabilityMessage('');
    setSelectedSlot('');
  }
  async function search() {
    clearOffers();
    const result = await apiClient.availability({
      locationId: location,
      appointmentTypeId: type,
      date,
    });
    setSlots(result.slots);
    setAvailabilityMessage(
      result.slots.length
        ? t('availability.count', { count: result.slots.length })
        : t('availability.empty'),
    );
  }
  function openBooking(appointment?: Appointment) {
    clearOffers();
    setReason('');
    setError('');
    if (appointment) setType(appointment.appointmentTypeId);
    setModal(appointment ? { kind: 'reschedule', appointment } : { kind: 'book' });
  }
  async function submitBooking() {
    if (modal?.kind === 'reschedule' && modal.appointment)
      await apiClient.rescheduleAppointment(
        modal.appointment.id,
        selectedSlot,
        modal.appointment.revision,
      );
    else if (staff) await apiClient.bookStaffAppointment(selectedSlot, patientId);
    else await apiClient.bookAppointment(selectedSlot);
    await refresh();
  }
  return {
    catalog,
    setCatalog,
    items,
    setItems,
    view,
    setView,
    calendarDate,
    setCalendarDate,
    offset,
    setOffset,
    nextOffset,
    setNextOffset,
    location,
    setLocation,
    type,
    setType,
    date,
    setDate,
    slots,
    setSlots,
    availabilityMessage,
    setAvailabilityMessage,
    selectedSlot,
    setSelectedSlot,
    patientId,
    setPatientId,
    modal,
    setModal,
    reason,
    setReason,
    busy,
    setBusy,
    notification,
    setNotification,
    error,
    setError,
    history,
    setHistory,
    now,
    setNow,
    roles,
    staff,
    admin,
    clinicalStaff,
    refresh,
    run,
    timezone,
    clearOffers,
    search,
    openBooking,
    submitBooking,
  };
}
