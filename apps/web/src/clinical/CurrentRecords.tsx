import type { ClinicalRecord, ClinicalWorkspace } from '@dentalai/contracts';
import { t } from '../i18n';
import { RecordView } from './RecordView';
import { StatusBadge } from '../ui/StatusBadge';
export function CurrentRecords({
  records,
  workspace,
  encounterId,
  historical,
  correct,
  review,
}: {
  records: ClinicalRecord[];
  workspace: ClinicalWorkspace;
  encounterId: string;
  historical: string;
  correct: (record: ClinicalRecord) => void;
  review: (kind: 'approved' | 'rejected', id: string) => void;
}) {
  return (
    <>
      {' '}
      <h2 className="text-xl font-bold">{t('ui.29fb351865b85f0c')}</h2>
      {!records.length && <p>{t('ui.224b68222cef14cf')}</p>}
      {records.map((r) => (
        <article key={r.id} className="ui-card space-y-3">
          <h3 className="font-bold">
            {r.data.kind} {t('ui.8d3940c51091ed0a')}
            {r.version} · <StatusBadge value={r.approval} />
          </h3>
          <RecordView data={r.data} />
          <p className="text-sm text-slate-500">
            {r.authorName} · {new Date(r.recordedAt).toLocaleString()} {t('ui.a09fac59690f30e1')}
            {r.reason}
          </p>
          {r.reviewReason && (
            <p>
              {t('ui.2a60e203a021a1bd')}
              {r.reviewReason}
            </p>
          )}
          {!historical && encounterId && (
            <button className="text-indigo-600" onClick={() => correct(r)}>
              {t('ui.63923d8dd78e91fc')}
              {r.data.kind}
            </button>
          )}
          {!historical &&
            r.approval === 'pending' &&
            workspace.encounters.some((e) => e.id === r.encounterId && e.status === 'open') && (
              <div className="flex gap-4">
                <button onClick={() => review('approved', r.id)}>
                  {t('ui.cb4b2563545a3150')}
                  {r.data.kind}
                </button>
                <button onClick={() => review('rejected', r.id)}>
                  {t('ui.02b24c18771cae8c')}
                  {r.data.kind}
                </button>
              </div>
            )}
        </article>
      ))}
    </>
  );
}
