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
          DentalAI · Account
        </Link>
        <h1 className="text-3xl font-bold">Approved clinical history</h1>
        <p>
          Read-only information explicitly approved by a clinician. Drafts and private review
          reasons are not shared here.
        </p>
        <button onClick={() => void refresh()} className="text-indigo-600">
          Refresh approved records
        </button>
        {loading && <p role="status">Loading approved history…</p>}
        {error && (
          <p role="alert">
            {error} <button onClick={() => void refresh()}>Retry</button>
          </p>
        )}
        {value && !loading && (
          <>
            <Odontogram records={value.records} />
            {!value.records.length && <p>No approved clinical information is available yet.</p>}
            {value.records.map((r) => (
              <article key={r.id} className="bg-white border rounded-2xl p-5">
                <h2 className="font-bold">{r.data.kind}</h2>
                <RecordView data={r.data} />
                <p className="text-sm text-slate-500">
                  Recorded {new Date(r.recordedAt).toLocaleString()} · Approved{' '}
                  {new Date(r.approvedAt).toLocaleString()}
                </p>
              </article>
            ))}
            <details className="bg-white border rounded-2xl p-5">
              <summary>Approved version history ({value.history.length})</summary>
              {value.history.map((r) => (
                <article key={r.id} className="border-b py-3">
                  <p>
                    {r.data.kind} · version {r.version} ·{' '}
                    {r.superseded ? 'superseded approved version' : 'current approved version'} ·{' '}
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
