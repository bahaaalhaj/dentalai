import { t } from '../i18n';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ActionDialog } from '@dentalai/ui';
import type { ClinicalRecord, ClinicalWorkspace } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { Odontogram } from './Odontogram';
import { RecordView } from './RecordView';
import { ClinicalRecordEditor } from './ClinicalRecordEditor';
import { AnestheticCalculator } from '../components/AnestheticCalculator';

type Action = { kind: 'start' | 'close' | 'approved' | 'rejected'; id: string };
export function ClinicianPatientsPage() {
  const [patients, setPatients] = useState<Awaited<ReturnType<typeof apiClient.clinicalPatients>>>(
    [],
  );
  const [patientId, setPatientId] = useState('');
  const [workspace, setWorkspace] = useState<ClinicalWorkspace | null>(null);
  const [encounterId, setEncounterId] = useState('');
  const [historical, setHistorical] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<{
    correction: ClinicalRecord | null;
    tooth?: string;
  } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(Symbol('clinical request'));
  const scope = useRef({ patientId: '', historical: '' });
  const refresh = useCallback(async () => {
    if (patientId !== scope.current.patientId || historical !== scope.current.historical) return;
    const sequence = Symbol('clinical request');
    requestSequence.current = sequence;
    setLoading(true);
    setError('');
    try {
      const list = await apiClient.clinicalPatients();
      if (sequence !== requestSequence.current) return;
      setPatients(list);
      if (patientId) {
        const value = await apiClient.clinicalWorkspace(patientId, historical || undefined);
        if (sequence !== requestSequence.current) return;
        setWorkspace(value);
        setEncounterId((current) =>
          value.encounters.some((e) => e.id === current && e.status === 'open')
            ? current
            : (value.encounters.find((e) => e.status === 'open')?.id ?? ''),
        );
      }
    } catch (e) {
      if (sequence === requestSequence.current) setError(getErrorMessage(e));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [patientId, historical]);
  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current = Symbol('discard stale request');
    };
  }, [refresh]);
  const open = (next: Action) => {
    setAction(next);
    setReason('');
    setError('');
  };
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <Link to="/dashboard" className="text-indigo-600">
          {t('ui.5da1476388be416f')}
        </Link>
        <h1 className="text-3xl font-bold text-slate-900">{t('ui.794807d3934392d8')}</h1>
        <p>{t('ui.983e815edc70f260')}</p>
        <button onClick={() => void refresh()} className="text-indigo-600">
          {t('ui.389993ea8fe8f59b')}
        </button>
        {loading && <p role="status">{t('ui.02480e653e71869b')}</p>}
        {error && (
          <div role="alert" className="p-4 rounded-xl bg-red-50 text-red-800">
            {error} <button onClick={() => void refresh()}>{t('ui.942087cc2d41e013')}</button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {!loading && !patients.length && <p>{t('ui.b1ab306e0f568497')}</p>}
        <label className="block">
          {t('ui.835043ec8e6b7921')}
          <select
            aria-label={t('ui.835043ec8e6b7921')}
            className="w-full p-3 border rounded-xl"
            value={patientId}
            onChange={(e) => {
              scope.current = { patientId: e.target.value, historical: '' };
              requestSequence.current = Symbol('discard previous patient');
              setWorkspace(null);
              setEditor(null);
              setPatientId(e.target.value);
              setHistorical('');
              setEncounterId('');
            }}
          >
            <option value="">{t('ui.36512653e9fdc43c')}</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.givenName} {p.familyName} · {p.medicalRecordNumber}
              </option>
            ))}
          </select>
        </label>
        {workspace && !loading && (
          <>
            <h2 className="font-bold">
              {workspace.patient.givenName} {workspace.patient.familyName}
            </h2>
            <AnestheticCalculator key={patientId} patientId={patientId} />
            <section className="bg-white border rounded-2xl p-5 space-y-3">
              <h2 className="text-xl font-bold">{t('ui.e12625129e52a1ab')}</h2>
              <button
                onClick={() => open({ kind: 'start', id: patientId })}
                className="text-indigo-600"
              >
                {t('ui.ee4974f57be9edc0')}
              </button>
              {!workspace.encounters.length && <p>{t('ui.383e16f61ca805b6')}</p>}
              <label className="block">
                {t('ui.ffcce44b5ffe7fc7')}
                <select
                  aria-label={t('ui.ffcce44b5ffe7fc7')}
                  className="w-full p-3 border rounded-xl"
                  value={encounterId}
                  onChange={(e) => {
                    setEncounterId(e.target.value);
                    setEditor(null);
                  }}
                >
                  <option value="">{t('ui.5d2de50a3f800d7d')}</option>
                  {workspace.encounters
                    .filter((e) => e.status === 'open')
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {new Date(e.startedAt).toLocaleString()} · {e.authorName}
                      </option>
                    ))}
                </select>
              </label>
              {encounterId && !historical && (
                <button onClick={() => open({ kind: 'close', id: encounterId })}>
                  {t('ui.aa62874387c0a3b7')}
                </button>
              )}
              <label className="block">
                {t('ui.96ddcf26ee68ab76')}
                <select
                  aria-label={t('ui.96ddcf26ee68ab76')}
                  className="w-full p-3 border rounded-xl"
                  value={historical}
                  onChange={(e) => {
                    scope.current = { patientId, historical: e.target.value };
                    requestSequence.current = Symbol('discard previous historical view');
                    setHistorical(e.target.value);
                    setEditor(null);
                  }}
                >
                  <option value="">{t('ui.e577f7bee7c56721')}</option>
                  {workspace.encounters
                    .filter((e) => e.status !== 'open')
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {t('ui.616c9bf0809394db')}
                        {new Date(e.endedAt ?? e.startedAt).toLocaleString()}
                      </option>
                    ))}
                </select>
              </label>
            </section>
            <Odontogram
              records={workspace.records}
              {...(encounterId && !historical
                ? { select: (tooth: string) => setEditor({ correction: null, tooth }) }
                : {})}
            />
            {encounterId && !historical && (
              <button
                className="bg-indigo-600 text-white p-3 rounded-xl"
                onClick={() => setEditor({ correction: null })}
              >
                {t('ui.31e327288770e40c')}
              </button>
            )}
            {editor && encounterId && (
              <ClinicalRecordEditor
                key={`${editor.correction?.id ?? editor.tooth ?? 'new'}:${encounterId}`}
                workspace={workspace}
                encounterId={encounterId}
                correction={editor.correction}
                tooth={editor.tooth}
                cancel={() => setEditor(null)}
                onSave={async (body) => {
                  await apiClient.writeClinicalRecord(patientId, body);
                  if (
                    patientId !== scope.current.patientId ||
                    historical !== scope.current.historical
                  )
                    return;
                  setEditor(null);
                  setMessage(t('ui.668f7e244fbd7305'));
                  await refresh();
                }}
              />
            )}
            <h2 className="text-xl font-bold">{t('ui.29fb351865b85f0c')}</h2>
            {!workspace.records.length && <p>{t('ui.224b68222cef14cf')}</p>}
            {workspace.records.map((r) => (
              <article key={r.id} className="bg-white rounded-2xl border p-5 space-y-2">
                <h3 className="font-bold">
                  {r.data.kind} {t('ui.8d3940c51091ed0a')}
                  {r.version} · {r.approval}
                </h3>
                <RecordView data={r.data} />
                <p className="text-sm text-slate-500">
                  {r.authorName} · {new Date(r.recordedAt).toLocaleString()}{' '}
                  {t('ui.a09fac59690f30e1')}
                  {r.reason}
                </p>
                {r.reviewReason && (
                  <p>
                    {t('ui.2a60e203a021a1bd')}
                    {r.reviewReason}
                  </p>
                )}
                {!historical && encounterId && (
                  <button className="text-indigo-600" onClick={() => setEditor({ correction: r })}>
                    {t('ui.63923d8dd78e91fc')}
                    {r.data.kind}
                  </button>
                )}
                {!historical &&
                  r.approval === 'pending' &&
                  workspace.encounters.some(
                    (e) => e.id === r.encounterId && e.status === 'open',
                  ) && (
                    <div className="flex gap-4">
                      <button onClick={() => open({ kind: 'approved', id: r.id })}>
                        {t('ui.cb4b2563545a3150')}
                        {r.data.kind}
                      </button>
                      <button onClick={() => open({ kind: 'rejected', id: r.id })}>
                        {t('ui.02b24c18771cae8c')}
                        {r.data.kind}
                      </button>
                    </div>
                  )}
              </article>
            ))}
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
                          <dd className="whitespace-pre-wrap break-words">
                            {f.value ?? 'not recorded'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </details>
            )}
          </>
        )}
        {action && (
          <ActionDialog
            title={
              action.kind === 'start'
                ? t('ui.ee4974f57be9edc0')
                : action.kind === 'close'
                  ? t('ui.c1d4535afb397013')
                  : t('ui.07677ac30a789154', {
                      v0: action.kind === 'approved' ? t('action.approve') : t('action.reject'),
                    })
            }
            busy={busy}
            onClose={() => {
              if (!busy) setAction(null);
            }}
          >
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  if (action.kind === 'start') {
                    const encounter = await apiClient.startEncounter(action.id, reason);
                    setEncounterId(encounter.id);
                    scope.current = { patientId, historical: '' };
                    setHistorical('');
                  } else if (action.kind === 'close')
                    await apiClient.closeEncounter(action.id, reason);
                  else await apiClient.reviewClinicalRecord(action.id, action.kind, reason);
                  setAction(null);
                  setMessage(t('ui.e396f92b18ef2373'));
                  await refresh();
                } catch (err) {
                  setError(getErrorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="block">
                {t('ui.f81ab834de5f8491')}
                <input
                  className="w-full border p-3 rounded-xl"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <button
                disabled={busy}
                className="bg-indigo-600 text-white p-3 rounded-xl"
                type="submit"
              >
                {t('ui.90e78994be99912c')}
              </button>
            </form>
          </ActionDialog>
        )}
      </div>
    </main>
  );
}
