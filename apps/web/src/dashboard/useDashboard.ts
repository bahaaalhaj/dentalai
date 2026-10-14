import { useCallback, useEffect, useState } from 'react';
import type {
  AuthIdentity,
  Appointment,
  BillingCatalog,
  ClinicalPortal,
  SchedulingCatalog,
  AdministrationOverviewSchema,
  BillingReportSchema,
  AuditSummarySchema,
} from '@dentalai/contracts';
import type { z } from 'zod';
import { clinicToday } from '@dentalai/domain';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';

export type DashboardData = {
  upcoming: Appointment[];
  history: Appointment[];
  today: Appointment[];
  catalog: SchedulingCatalog;
  patients: BillingCatalog['patients'];
  report: z.infer<typeof BillingReportSchema>;
  administration: z.infer<typeof AdministrationOverviewSchema> | null;
  portal: ClinicalPortal | null;
  audit: z.infer<typeof AuditSummarySchema>;
  paginated: boolean;
};
export function useDashboard(identity: AuthIdentity) {
  const member = identity.activeMembership;
  const [data, setData] = useState<DashboardData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const roles = member?.roles.join(',') ?? '';
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (!member) {
      setLoading(false);
      return;
    }
    const staff = member.roles.some((role) => role !== 'patient');
    const admin = member.roles.some((role) => role === 'clinic_owner' || role === 'clinic_admin');
    async function load() {
      const catalog = await apiClient.schedulingCatalog();
      const date = clinicToday(catalog.clinicTimezone);
      const [upcoming, history, todayUpcoming, todayHistory] = await Promise.all([
        apiClient.appointments({ view: 'upcoming', limit: 100 }),
        apiClient.appointments({ view: 'history', limit: 100 }),
        apiClient.appointments({ view: 'upcoming', date, limit: 100 }),
        apiClient.appointments({ view: 'history', date, limit: 100 }),
      ]);
      const [patients, report, administration, portal, audit] = await Promise.all([
        member!.roles.includes('dentist')
          ? apiClient.clinicalPatients()
          : staff
            ? apiClient.billingCatalog().then((value) => value.patients)
            : Promise.resolve([]),
        staff ? apiClient.billingReports() : Promise.resolve([]),
        admin ? apiClient.administration() : Promise.resolve(null),
        !staff && member!.roles.includes('patient')
          ? apiClient.clinicalPortal()
          : Promise.resolve(null),
        member!.roles.includes('clinic_owner')
          ? apiClient.administrationAudit()
          : Promise.resolve([]),
      ]);
      if (active)
        setData({
          catalog,
          patients,
          report,
          administration,
          portal,
          audit,
          upcoming: upcoming.items,
          history: history.items,
          today: [...todayUpcoming.items, ...todayHistory.items],
          paginated: [upcoming, history, todayUpcoming, todayHistory].some(
            (value) => value.nextOffset !== null,
          ),
        });
    }
    void load()
      .catch((e: unknown) => {
        if (active) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Clinic-scoped pages are also keyed by server membership ID; stale responses cannot replace a new clinic.
  }, [member, roles, revision]);
  return { data, loading, error, refresh };
}
