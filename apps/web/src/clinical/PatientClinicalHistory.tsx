import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ClinicalPortal } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { RecordView } from './RecordView';
import { Odontogram } from './Odontogram';
export function PatientClinicalHistory() {
  const [value, setValue] = useState<ClinicalPortal | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setValue(await apiClient.clinicalPortal());
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    apiClient
      .clinicalPortal()
      .then((v) => {
        if (active) setValue(v);
      })
      .catch((e: unknown) => {
        if (active) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <Link to="/dashboard" className="text-indigo-600">
          {t('ui.5da1476388be416f')}
        </Link>
        <h1 className="text-3xl font-bold">{t('ui.4db883d983b471bb')}</h1>
        <p>{t('ui.d175a59b4a351b28')}</p>
        <button onClick={() => void refresh()} className="text-indigo-600">
          {t('ui.fbc1285579f34cf8')}
        </button>
        {loading && <p role="status">{t('ui.ad8279f9db999398')}</p>}
        {error && (
          <p role="alert">
            {error} <button onClick={() => void refresh()}>{t('ui.942087cc2d41e013')}</button>
          </p>
        )}
        {value && !loading && (
          <>
            <Odontogram records={value.records} approvedProjection />
            {!value.records.length && <p>{t('ui.b67b362d895b9f80')}</p>}
            {value.records.map((r) => (
              <article key={r.id} className="bg-white border rounded-2xl p-5">
                <h2 className="font-bold">{r.data.kind}</h2>
                <RecordView data={r.data} />
                <p className="text-sm text-slate-500">
                  {t('ui.0a8e2942da9ceb15')}
                  {new Date(r.recordedAt).toLocaleString()} {t('ui.795b018e57721286')}{' '}
                  {new Date(r.approvedAt).toLocaleString()}
                </p>
              </article>
            ))}
            <details className="bg-white border rounded-2xl p-5">
              <summary>
                {t('ui.b00816402c546d0c')}
                {value.history.length})
              </summary>
              {value.history.map((r) => (
                <article key={r.id} className="border-b py-3">
                  <p>
                    {r.data.kind} {t('ui.8d3940c51091ed0a')}
                    {r.version} ·{' '}
                    {r.superseded ? t('ui.e618e987f96c7614') : t('ui.fac8c80c974b185d')} ·{' '}
                    {r.recordedAt}
                  </p>
                  <RecordView data={r.data} />
                </article>
              ))}
            </details>
          </>
        )}
      </div>
    </main>
  );
}
