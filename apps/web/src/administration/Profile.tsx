import { useState } from 'react';
import { t } from '../i18n';
import { apiClient } from '../lib/api-client';
import { ClinicFields } from './ClinicFields';
import type { ClinicFieldsValue } from './initial-clinic';
import { Field } from '../clinical/ClinicalFields';

export function Profile({
  value,
  busy,
  apply,
}: {
  value: ClinicFieldsValue & { version: number };
  busy: boolean;
  apply: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [configuration, setConfiguration] = useState<ClinicFieldsValue>({
      legalName: value.legalName,
      displayName: value.displayName,
      currency: value.currency,
      timezone: value.timezone,
      locale: value.locale,
      contactEmail: value.contactEmail,
      contactPhone: value.contactPhone,
      brandColor: value.brandColor,
      brandMark: value.brandMark,
    }),
    [reason, setReason] = useState('');
  return (
    <section className="bg-white border rounded-2xl p-5 space-y-3">
      <h2 className="font-bold">{t('admin.profile')}</h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(() =>
            apiClient.configureClinic({ ...configuration, version: value.version, reason }),
          );
        }}
      >
        <ClinicFields value={configuration} onChange={setConfiguration} />
        <Field label={t('admin.reason')} value={reason} onChange={setReason} required />
        <button
          className="bg-indigo-600 text-white px-5 py-3 rounded-xl disabled:opacity-50"
          disabled={busy || reason.trim().length < 3}
        >
          {t('admin.save')}
        </button>
      </form>
    </section>
  );
}
