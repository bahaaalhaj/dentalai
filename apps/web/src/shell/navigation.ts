import type { ClinicRole } from '@dentalai/contracts';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  NotebookPen,
  ScanLine,
  CreditCard,
  Building2,
  UserPlus,
  Shield,
  ClipboardList,
  Activity,
} from 'lucide-react';
import type { TranslationKey } from '../i18n';
export function workspaceNavigation(roles: readonly ClinicRole[], hasClinic: boolean) {
  const staff = roles.some((role) => role !== 'patient');
  const dentist = roles.includes('dentist');
  const admin = roles.some((role) => role === 'clinic_owner' || role === 'clinic_admin');
  const items: {
    to: string;
    label: TranslationKey;
    icon: typeof LayoutDashboard;
    group: 'work' | 'manage' | 'account';
  }[] = [{ to: '/dashboard', label: 'polish.overview', icon: LayoutDashboard, group: 'work' }];
  if (hasClinic) {
    if (staff)
      items.push({ to: '/patients', label: 'polish.patients', icon: Users, group: 'work' });
    items.push({
      to: '/appointments',
      label: 'ui.a1164b91bb0b2fad',
      icon: CalendarDays,
      group: 'work',
    });
    if (dentist)
      items.push(
        {
          to: '/clinical/patients',
          label: 'ui.794807d3934392d8',
          icon: NotebookPen,
          group: 'work',
        },
        {
          to: '/clinical/patients?tab=chart',
          label: 'polish.chart',
          icon: Activity,
          group: 'work',
        },
        {
          to: '/clinical/patients?tab=plans',
          label: 'polish.plans',
          icon: ClipboardList,
          group: 'work',
        },
        { to: '/imaging', label: 'polish.imaging', icon: ScanLine, group: 'work' },
      );
    if (staff)
      items.push({ to: '/billing', label: 'ui.334a67136be1afb3', icon: CreditCard, group: 'work' });
    if (roles.includes('patient'))
      items.push(
        { to: '/clinical/history', label: 'ui.4db883d983b471bb', icon: NotebookPen, group: 'work' },
        { to: '/billing/portal', label: 'ui.e0d166dca6b8ae62', icon: CreditCard, group: 'work' },
      );
    if (admin)
      items.push(
        { to: '/administration', label: 'admin.title', icon: Building2, group: 'manage' },
        { to: '/administration?tab=team', label: 'polish.team', icon: UserPlus, group: 'manage' },
      );
    if (roles.includes('clinic_owner'))
      items.push({
        to: '/administration?tab=operations',
        label: 'polish.operations',
        icon: Shield,
        group: 'manage',
      });
  }
  items.push({ to: '/dashboard#account', label: 'polish.account', icon: Shield, group: 'account' });
  return items;
}
