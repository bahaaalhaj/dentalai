import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ActionDialog } from '@dentalai/ui';
import type { ClinicalRecord, ClinicalWorkspace } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { Odontogram } from './Odontogram';
import { RecordView } from './RecordView';
import { ClinicalRecordEditor } from './ClinicalRecordEditor';

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
          DentalAI · Account
        </Link>
        <h1 className="text-3xl font-bold text-slate-900">Clinical patients</h1>
        <p>
          Clinician-authored records. Experimental X-ray and anesthetic decision support remain
          frozen.
        </p>
        <button onClick={() => void refresh()} className="text-indigo-600">
          Refresh clinical records
        </button>
        {loading && <p role="status">Loading clinical records…</p>}
        {error && (
          <div role="alert" className="p-4 rounded-xl bg-red-50 text-red-800">
            {error} <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {!loading && !patients.length && <p>No clinical patients are available in this clinic.</p>}
        <label className="block">
          Patient
          <select
            aria-label="Patient"
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
            <option value="">Select patient</option>
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
            <section className="bg-white border rounded-2xl p-5 space-y-3">
              <h2 className="text-xl font-bold">Encounters / visits</h2>
              <button
                onClick={() => open({ kind: 'start', id: patientId })}
                className="text-indigo-600"
              >
                Start encounter
              </button>
              {!workspace.encounters.length && (
                <p>No encounters yet. Start a visit to record clinical information.</p>
              )}
              <label className="block">
                Open encounter
                <select
                  aria-label="Open encounter"
                  className="w-full p-3 border rounded-xl"
                  value={encounterId}
                  onChange={(e) => {
                    setEncounterId(e.target.value);
                    setEditor(null);
                  }}
                >
                  <option value="">Select open encounter</option>
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
                  Close and sign encounter
                </button>
              )}
              <label className="block">
                Historical reconstruction
                <select
                  aria-label="Historical reconstruction"
                  className="w-full p-3 border rounded-xl"
                  value={historical}
                  onChange={(e) => {
                    scope.current = { patientId, historical: e.target.value };
                    requestSequence.current = Symbol('discard previous historical view');
                    setHistorical(e.target.value);
                    setEditor(null);
                  }}
                >
                  <option value="">Current records</option>
                  {workspace.encounters
                    .filter((e) => e.status !== 'open')
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        As of {new Date(e.endedAt ?? e.startedAt).toLocaleString()}
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
                Add clinical entry
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
                  setMessage('Draft saved. Approval is still required.');
                  await refresh();
                }}
              />
            )}
            <h2 className="text-xl font-bold">Current clinical records</h2>
            {!workspace.records.length && <p>No clinical entries recorded.</p>}
            {workspace.records.map((r) => (
              <article key={r.id} className="bg-white rounded-2xl border p-5 space-y-2">
                <h3 className="font-bold">
                  {r.data.kind} · version {r.version} · {r.approval}
                </h3>
                <RecordView data={r.data} />
                <p className="text-sm text-slate-500">
                  {r.authorName} · {new Date(r.recordedAt).toLocaleString()} · reason: {r.reason}
                </p>
                {r.reviewReason && <p>Review: {r.reviewReason}</p>}
                {!historical && encounterId && (
                  <button className="text-indigo-600" onClick={() => setEditor({ correction: r })}>
                    Correct or transition {r.data.kind}
                  </button>
                )}
                {!historical &&
                  r.approval === 'pending' &&
                  workspace.encounters.some(
                    (e) => e.id === r.encounterId && e.status === 'open',
                  ) && (
                    <div className="flex gap-4">
                      <button onClick={() => open({ kind: 'approved', id: r.id })}>
                        Approve {r.data.kind}
                      </button>
                      <button onClick={() => open({ kind: 'rejected', id: r.id })}>
                        Reject {r.data.kind}
                      </button>
                    </div>
                  )}
              </article>
            ))}
            <details className="bg-white border rounded-2xl p-5">
              <summary className="cursor-pointer font-bold">
                Complete version history ({workspace.history.length})
              </summary>
              {workspace.history.map((r) => (
                <article key={r.id} className="border-b py-4">
                  <p>
                    {r.data.kind} · v{r.version} · {r.approval} · {r.authorName} · {r.recordedAt}
                  </p>
                  <RecordView data={r.data} />
                  <p>
                    Reason: {r.reason} · Review: {r.reviewReason ?? 'pending'}
                  </p>
                </article>
              ))}
            </details>
            {!!workspace.legacyRecords.length && (
              <details className="bg-amber-50 border rounded-2xl p-5">
                <summary>
                  Retained legacy SQL records ({workspace.legacyRecords.length}) — reconciliation
                  required
                </summary>
                <p>
                  Read-only archive, not automatically approved or included in the odontogram. Tooth
                  notation and historical provenance require manual verification. This archive is
                  not an as-of reconstruction.
                </p>
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
                ? 'Start encounter'
                : action.kind === 'close'
                  ? 'Close encounter'
                  : `${action.kind === 'approved' ? 'Approve' : 'Reject'} clinical entry`
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
                  setMessage('Clinical change recorded.');
                  await refresh();
                } catch (err) {
                  setError(getErrorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="block">
                Reason
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
                Apply clinical change
              </button>
            </form>
          </ActionDialog>
        )}
      </div>
    </main>
  );
}
