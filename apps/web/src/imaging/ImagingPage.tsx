import { t } from '../i18n';
import { StudyCard } from './StudyCard';
import { UploadDropZone } from './UploadDropZone';
import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { ImagingHistory } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';

export function ImagingPage() {
  const [patients, setPatients] = useState<Awaited<ReturnType<typeof apiClient.clinicalPatients>>>(
    [],
  );
  const [patient, setPatient] = useState('');
  const [history, setHistory] = useState<ImagingHistory>();
  const [file, setFile] = useState<File>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const retryKeys = useRef(new Map<string, string>());
  const requestKey = (operation: string) => {
    if (!retryKeys.current.has(operation)) retryKeys.current.set(operation, crypto.randomUUID());
    return retryKeys.current.get(operation)!;
  };
  const [capabilities, setCapabilities] =
    useState<Awaited<ReturnType<typeof apiClient.imagingCapabilities>>>();
  useEffect(() => {
    let active = true;
    apiClient
      .imagingCapabilities()
      .then((c) => {
        if (active) setCapabilities(c);
      })
      .catch(() => {
        if (active) setError(t('ui.85d2c4526dbb94d2'));
      });
    return () => {
      active = false;
    };
  }, []);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    apiClient
      .clinicalPatients()
      .then((p) => {
        if (active) setPatients(p);
      })
      .catch(() => {
        if (active) setError(t('ui.1dac0fe8ada616e2'));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setHistory(undefined);
    setFile(undefined);
    retryKeys.current.clear();
    setError('');
    if (!patient) return;
    let active = true;
    apiClient
      .imagingHistory(patient)
      .then((h) => {
        if (active) setHistory(h);
      })
      .catch(() => {
        if (active) setError(t('ui.925dc38c25628e5f'));
      });
    return () => {
      active = false;
    };
  }, [patient]);
  async function action(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setHistory(await apiClient.imagingHistory(patient));
      retryKeys.current.clear();
      setNotice(t('ui.5ce042a0450dc852'));
    } catch (e) {
      setError(getErrorMessage(e));
      try {
        setHistory(await apiClient.imagingHistory(patient));
      } catch {
        /* Keep existing history; do not invent data. */
      }
    } finally {
      setBusy(false);
    }
  }
  const valid = reason.trim().length >= 3 && reason.length <= 500;
  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-800">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link to="/dashboard" className="text-indigo-700">
          {t('ui.b59e0c1cc1e1faf9')}
        </Link>
        <h1 className="text-2xl font-bold">{t('ui.ef234b9f5937a9e6')}</h1>
        <p className="ui-safety-notice">{t('ui.617b9f5ba5dc5589')}</p>
        {capabilities && !capabilities.storageConfigured && (
          <p role="status">{t('ui.8ba48c3114fac053')}</p>
        )}
        {capabilities && !capabilities.inferenceConfigured && (
          <p role="status">{t('ui.090ad19194e800ce')}</p>
        )}
        <label className="block">
          {t('ui.835043ec8e6b7921')}
          <select
            value={patient}
            onChange={(e) => setPatient(e.target.value)}
            disabled={busy}
            className="ms-3 rounded border p-2"
          >
            <option value="">{t('ui.36512653e9fdc43c')}</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.givenName} {p.familyName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {t('ui.80a644621b6d1a00')}
          <input
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded border p-2"
          />
        </label>
        {!valid && <p className="text-sm">{t('ui.66af6fddbd74188e')}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (file)
              void action(() =>
                apiClient.uploadClinicalImage(
                  patient,
                  file,
                  reason,
                  undefined,
                  requestKey(
                    JSON.stringify([
                      'upload',
                      patient,
                      reason,
                      file.name,
                      file.size,
                      file.lastModified,
                    ]),
                  ),
                ),
              );
          }}
          className="ui-card space-y-4"
        >
          <UploadDropZone
            key={patient}
            file={file}
            busy={busy}
            choose={setFile}
            reject={() => setError(t('polish.fileRejected'))}
          />
          <button
            disabled={!capabilities?.storageConfigured || !patient || !file || !valid || busy}
            className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {t('ui.15bfd0d3dca50ed1')}
          </button>
        </form>
        {busy && (
          <div role="status">
            <p>{t('polish.uploading')}</p>
            <progress aria-label={t('polish.uploading')} />
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {patient && !history && !error && <p role="status">{t('ui.ea3e18eff454e041')}</p>}
        {history?.images.length === 0 && <p>{t('ui.b765570f6e945578')}</p>}
        <h2 className="ui-section-title">{t('polish.studies')}</h2>
        <div className="ui-grid">
          {history?.images.map((image) => (
            <StudyCard
              key={image.id}
              image={image}
              history={history}
              capabilities={capabilities}
              valid={valid}
              busy={busy}
              file={file}
              patient={patient}
              reason={reason}
              action={action}
              requestKey={requestKey}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
