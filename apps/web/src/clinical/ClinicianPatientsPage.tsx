import { t } from '../i18n';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionDialog } from '@dentalai/ui';
import type { ClinicalRecord, ClinicalWorkspace } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { Odontogram } from './Odontogram';
import { EncounterContext } from './EncounterContext';
import { CurrentRecords } from './CurrentRecords';
import { ClinicalHistory } from './ClinicalHistory';
import { SectionTabs } from '../ui/SectionTabs';
import { StatusBadge } from '../ui/StatusBadge';
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
  const [search, setSearch] = useState('');
  const [parameters, setParameters] = useSearchParams();
  const requestedTab = parameters.get('tab');
  const tab = ['summary', 'encounters', 'notes', 'chart', 'plans', 'imaging', 'history'].includes(
    requestedTab ?? '',
  )
    ? requestedTab!
    : 'summary';
  const setTab = (value: string) =>
    setParameters({ ...Object.fromEntries(parameters), tab: value });
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
  useEffect(() => {
    const requestedPatient = parameters.get('patient');
    if (
      !patientId &&
      requestedPatient &&
      patients.some((patient) => patient.id === requestedPatient)
    ) {
      scope.current = { patientId: requestedPatient, historical: '' };
      setPatientId(requestedPatient);
    }
  }, [parameters, patients, patientId]);
  const open = (next: Action) => {
    setAction(next);
    setReason('');
    setError('');
  };
  const tabs = [
    ['summary', 'polish.summary'],
    ['encounters', 'polish.encounters'],
    ['notes', 'polish.notes'],
    ['chart', 'polish.chart'],
    ['plans', 'polish.plans'],
    ['imaging', 'polish.imaging'],
    ['history', 'polish.history'],
  ] as const;
  const visibleRecords =
    workspace?.records.filter((record) =>
      tab === 'notes'
        ? record.data.kind === 'note'
        : tab === 'plans'
          ? record.data.kind === 'plan'
          : tab === 'chart'
            ? ['finding', 'procedure'].includes(record.data.kind)
            : tab === 'summary'
              ? !['finding', 'procedure', 'plan'].includes(record.data.kind)
              : false,
    ) ?? [];
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
          {t('polish.searchPatients')}
          <input
            className="ui-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('polish.searchHint')}
          />
        </label>
        <label className="block">
          {t('ui.835043ec8e6b7921')}
          <select
            aria-label={t('ui.835043ec8e6b7921')}
            className="w-full p-3 border rounded-xl"
            value={patientId}
            disabled={busy}
            onChange={(e) => {
              setAction(null);
              setReason('');
              setMessage('');
              setError('');
              if (parameters.has('patient')) {
                const next = new URLSearchParams(parameters);
                next.delete('patient');
                setParameters(next, { replace: true });
              }
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
            {patients
              .filter(
                (p) =>
                  !search ||
                  [p.givenName, p.familyName, p.medicalRecordNumber]
                    .join(' ')
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.givenName} {p.familyName} · {p.medicalRecordNumber}
                </option>
              ))}
          </select>
        </label>
        {workspace && !loading && (
          <>
            <div className="ui-patient-header">
              <span className="ui-avatar" aria-hidden="true">
                {workspace.patient.givenName.slice(0, 1)}
              </span>
              <div>
                <h2 className="font-bold">
                  {workspace.patient.givenName} {workspace.patient.familyName}
                </h2>
                <p className="ui-caption">
                  {t('polish.recordNumber')}: <bdi>{workspace.patient.medicalRecordNumber}</bdi>
                </p>
              </div>
            </div>
            <AnestheticCalculator key={patientId} patientId={patientId} />
            <EncounterContext
              workspace={workspace}
              patientId={patientId}
              encounterId={encounterId}
              historical={historical}
              open={open}
              selectEncounter={(id) => {
                setEncounterId(id);
                setEditor(null);
              }}
              selectHistorical={(id) => {
                scope.current = { patientId, historical: id };
                requestSequence.current = Symbol('discard previous historical view');
                setHistorical(id);
                setEditor(null);
              }}
            />
            <SectionTabs
              tabs={tabs.map(([id, label]) => ({ id, label: t(label) }))}
              active={tab}
              change={setTab}
              label={t('ui.794807d3934392d8')}
            >
              {tab === 'summary' && (
                <section className="ui-card">
                  <h2>{t('polish.medicalContext')}</h2>
                  {!workspace.records.some((record) =>
                    ['alert', 'allergy', 'medication'].includes(record.data.kind),
                  ) && <p className="ui-caption mt-2">{t('polish.noAlerts')}</p>}
                </section>
              )}
              {tab === 'encounters' &&
                workspace.encounters.map((encounter) => (
                  <article className="ui-card" key={encounter.id}>
                    <StatusBadge value={encounter.status} />
                    <p>
                      {new Date(encounter.startedAt).toLocaleString()} · {encounter.authorName}
                    </p>
                  </article>
                ))}
              {tab === 'chart' && (
                <Odontogram
                  records={workspace.records}
                  {...(encounterId && !historical
                    ? { select: (tooth: string) => setEditor({ correction: null, tooth }) }
                    : {})}
                />
              )}
              {tab === 'imaging' && (
                <Link className="ui-btn-primary" to="/imaging">
                  {t('polish.imaging')}
                </Link>
              )}
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
              <CurrentRecords
                records={visibleRecords}
                workspace={workspace}
                encounterId={encounterId}
                historical={historical}
                correct={(record) => setEditor({ correction: record })}
                review={(kind, id) => open({ kind, id })}
              />
              {tab === 'history' && <ClinicalHistory workspace={workspace} />}
            </SectionTabs>
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
