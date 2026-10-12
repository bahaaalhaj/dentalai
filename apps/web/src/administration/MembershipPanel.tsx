import { useState } from 'react';
import type { z } from 'zod';
import type { StaffMemberSchema, MemberChangeSchema } from '@dentalai/contracts';
import { Field } from '../clinical/ClinicalFields';
import { t } from '../i18n';
export function MembershipPanel({
  members,
  self,
  owner,
  busy,
  apply,
}: {
  members: z.infer<typeof StaffMemberSchema>[];
  self: string;
  owner: boolean;
  busy: boolean;
  apply: (id: string, body: z.infer<typeof MemberChangeSchema>) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return (
    <section className="bg-white border rounded-2xl p-5 space-y-4">
      <h2 className="font-bold">{t('admin.members')}</h2>
      <Field label={t('admin.reason')} value={reason} onChange={setReason} required />
      {members.map((member) => (
        <MemberRow
          key={`${member.id}:${member.status}:${member.roles.join(',')}`}
          member={member}
          disabled={
            busy ||
            member.id === self ||
            member.roles.includes('clinic_owner') ||
            member.roles.every((r) => r === 'patient') ||
            (!owner && member.roles.includes('clinic_admin'))
          }
          owner={owner}
          apply={(body) => apply(member.id, body)}
          reason={reason}
        />
      ))}
    </section>
  );
}
function MemberRow({
  member,
  disabled,
  owner,
  apply,
  reason,
}: {
  member: z.infer<typeof StaffMemberSchema>;
  disabled: boolean;
  owner: boolean;
  apply: (body: z.infer<typeof MemberChangeSchema>) => Promise<void>;
  reason: string;
}) {
  const [role, setRole] = useState<z.infer<typeof MemberChangeSchema>['role']>(
    member.roles.includes('dentist')
      ? 'dentist'
      : member.roles.includes('clinic_admin')
        ? 'clinic_admin'
        : 'receptionist',
  );
  const [status, setStatus] = useState<z.infer<typeof MemberChangeSchema>['status']>(
    member.status === 'active' ? 'active' : member.status === 'suspended' ? 'suspended' : 'revoked',
  );
  return (
    <form
      className="flex flex-wrap gap-3 items-center border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void apply({ role, status, reason });
      }}
    >
      <span>
        <bdi>{member.name}</bdi>
        <br />
        <bdi>{member.email}</bdi>
        <br />
        {member.roles.join(', ')} · {member.status}
      </span>
      <label>
        {t('admin.members')}
        <select
          aria-label={t('ui.9ff7a11375394565', { v0: t('admin.members'), v1: member.email })}
          disabled={disabled}
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
        >
          {owner && <option value="clinic_admin">{t('role.clinic_admin')}</option>}
          <option value="dentist">{t('role.dentist')}</option>
          <option value="receptionist">{t('role.receptionist')}</option>
        </select>
      </label>
      <select
        aria-label={t('ui.9ff7a11375394565', { v0: t('admin.active'), v1: member.email })}
        disabled={disabled}
        value={status}
        onChange={(e) => setStatus(e.target.value as typeof status)}
      >
        <option value="active">{t('ui.92340695899bd2d8')}</option>
        <option value="suspended">{t('ui.e392a3891c070abe')}</option>
        <option value="revoked">{t('ui.f6f738d043929f59')}</option>
      </select>
      <button disabled={disabled || reason.trim().length < 3}>{t('admin.save')}</button>
    </form>
  );
}
