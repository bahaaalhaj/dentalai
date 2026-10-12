import { useState } from 'react';
import type { z } from 'zod';
import type { ExportSchema, OffboardingSchema } from '@dentalai/contracts';
import { ActionDialog } from '@dentalai/ui';
import { apiClient } from '../lib/api-client';
import { Field } from '../clinical/ClinicalFields';
import { t } from '../i18n';
export function ExportPanel({
  name,
  busy,
  apply,
}: {
  name: string;
  busy: boolean;
  apply: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState(''),
    [exported, setExported] = useState<z.infer<typeof ExportSchema> | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [confirming, setConfirming] = useState(false),
    [requested, setRequested] = useState(false);
  const complete: z.infer<typeof OffboardingSchema> = {
    reason,
    confirmation,
    exportId: exported?.id ?? '',
  };
  return (
    <section className="bg-white border rounded-2xl p-5 space-y-3">
      <h2 className="font-bold">{t('admin.export')}</h2>
      <p>{t('admin.exportWarning')}</p>
      <p>{t('admin.reauth')}</p>
      <Field label={t('admin.reason')} value={reason} onChange={setReason} required />
      <button
        disabled={busy || reason.trim().length < 3}
        onClick={() =>
          void apply(async () => {
            const data = await apiClient.exportClinic(reason);
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `dentalai-clinic-${data.clinicId}-${data.id}.json`;
            link.click();
            URL.revokeObjectURL(url);
            setExported(data);
          })
        }
      >
        {t('admin.exportCreate')}
      </button>
      {exported && (
        <div>
          <p>{t('admin.exportFiles')}</p>
          <p dir="ltr">
            {t('ui.b384167eba1c67b4')}
            {exported.sha256}
          </p>
          {exported.files.map((file) => (
            <a className="block underline" key={file.id} href={file.downloadPath} download>
              <bdi>
                {file.id} · {file.sizeBytes} {t('ui.932530fef31887a5')}
                {file.sha256}
              </bdi>
            </a>
          ))}
        </div>
      )}
      <p className="bg-amber-50 p-3 rounded-xl">{t('admin.offboardWarning')}</p>
      <button
        disabled={busy || reason.trim().length < 3}
        onClick={() =>
          void apply(async () => {
            await apiClient.requestOffboarding(reason);
            setRequested(true);
          })
        }
      >
        {t('admin.offboardRequest')}
      </button>{' '}
      <button disabled={busy || !requested || !exported} onClick={() => setConfirming(true)}>
        {t('admin.offboardComplete')}
      </button>
      {confirming && (
        <ActionDialog
          title={t('admin.offboardComplete')}
          onClose={() => setConfirming(false)}
          busy={busy}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(async () => {
                await apiClient.completeOffboarding(complete);
                window.location.assign('/dashboard');
              });
            }}
          >
            <p>{t('admin.offboardWarning')}</p>
            <p>
              <bdi>{name}</bdi>
            </p>
            <Field
              label={t('admin.confirmName')}
              value={confirmation}
              onChange={setConfirmation}
              required
            />
            <button disabled={busy || confirmation !== name}>{t('admin.offboardComplete')}</button>
          </form>
        </ActionDialog>
      )}
    </section>
  );
}
