import type { ClinicalWorkspace } from '@dentalai/contracts';
import { t } from '../i18n';
import { RecordView } from './RecordView';
export function ClinicalHistory({ workspace }: { workspace: ClinicalWorkspace }) {
  return (
    <>
      {' '}
      <details className="bg-white border rounded-2xl p-5">
        <summary className="cursor-pointer font-bold">
          {t('ui.e88eec8187bfd6d4')}
          {workspace.history.length})
        </summary>
        {workspace.history.map((r) => (
          <article key={r.id} className="border-b py-4">
            <p>
              {r.data.kind} {t('ui.0bb917d86bec6d62')}
              {r.version} · {r.approval} · {r.authorName} · {r.recordedAt}
            </p>
            <RecordView data={r.data} />
            <p>
              {t('ui.4bc4df5f6ced4467')}
              {r.reason} {t('ui.7837d5cddbc3e1a8')}
              {r.reviewReason ?? 'pending'}
            </p>
          </article>
        ))}
      </details>
      {!!workspace.legacyRecords.length && (
        <details className="bg-amber-50 border rounded-2xl p-5">
          <summary>
            {t('ui.48b139dea9c8d096')}
            {workspace.legacyRecords.length}
            {t('ui.8be6a2a0fe1fc43b')}
          </summary>
          <p>{t('ui.fc191a5b1ff0498e')}</p>
          {workspace.legacyRecords.map((r) => (
            <article key={`${r.kind}:${r.id}`} className="border-b py-3">
              <h3>
                {r.kind} · {r.id}
              </h3>
              <dl>
                {r.fields.map((f) => (
                  <div key={f.name}>
                    <dt className="font-semibold">{f.name}</dt>
                    <dd className="whitespace-pre-wrap break-words">{f.value ?? 'not recorded'}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </details>
      )}
    </>
  );
}
