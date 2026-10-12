import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ImagingHistory } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';

export function ImagingPage() {
  const [patients, setPatients] = useState<Awaited<ReturnType<typeof apiClient.clinicalPatients>>>(
    [],
  );
  const [patient, setPatient] = useState('');
  const [history, setHistory] = useState<ImagingHistory>();
  const [file, setFile] = useState<File>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
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
      setNotice(t('ui.5ce042a0450dc852'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation failed. Try again.');
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
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          {t('ui.617b9f5ba5dc5589')}
        </p>
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
            if (file) void action(() => apiClient.uploadClinicalImage(patient, file, reason));
          }}
          className="rounded-xl bg-white p-4"
        >
          <label>
            {t('ui.9eefe33e02c935dd')}
            <input
              key={patient}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0])}
              disabled={busy}
              className="block py-3"
            />
          </label>
          <button
            disabled={!capabilities?.storageConfigured || !patient || !file || !valid || busy}
            className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {t('ui.15bfd0d3dca50ed1')}
          </button>
        </form>
        {busy && <p role="status">{t('ui.23e39291d6135814')}</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {patient && !history && !error && <p role="status">{t('ui.ea3e18eff454e041')}</p>}
        {history?.images.length === 0 && <p>{t('ui.b765570f6e945578')}</p>}
        {history?.images.map((image) => (
          <section key={image.id} className="space-y-3 rounded-xl border bg-white p-4">
            <h2 className="font-semibold">
              {t('ui.8f8cf9c6d47777cc')}
              {image.studyId} {t('ui.44f2bf202ba8f6ae')}
              {image.version}
            </h2>
            <p>
              {image.width} × {image.height} · {image.createdAt}
            </p>
            <a
              href={`/api/v1/imaging/images/${image.id}/content`}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-700"
            >
              {t('ui.831890c867eb5620')}
            </a>
            <div className="flex gap-3">
              <button
                disabled={!capabilities?.inferenceConfigured || !valid || busy}
                onClick={() => void action(() => apiClient.analyzeClinicalImage(image.id, reason))}
                className="rounded border px-3 py-2"
              >
                {t('ui.35345d03d2a60d42')}
              </button>
              <button
                disabled={!capabilities?.storageConfigured || !file || !valid || busy}
                onClick={() => {
                  if (file)
                    void action(() =>
                      apiClient.uploadClinicalImage(patient, file, reason, image.studyId),
                    );
                }}
                className="rounded border px-3 py-2"
              >
                {t('ui.e380c283dc0a39b2')}
              </button>
            </div>
            {history.analyses
              .filter((r) => r.imageId === image.id)
              .map((run) => (
                <article key={run.id} className="rounded border p-3">
                  <h3>
                    {t('ui.3e2b8bb857d251fe')}
                    {run.status} {t('ui.7837d5cddbc3e1a8')}
                    {run.reviewState}
                  </h3>
                  {run.errorCode && <p>{t('ui.9a7809ab7d28e976')}</p>}
                  {run.result && (
                    <>
                      <p>
                        {t('ui.f7c40b97c6d5ee54')}
                        {run.result.modelName} / {run.result.modelVersion} ·{' '}
                        {run.result.latencyMs.toFixed(1)} {t('ui.f785c3ce1d580c8f')}
                      </p>
                      <p className="break-all text-xs">
                        {t('ui.c8036cef7ed6f9cd')}
                        {run.result.artifactSha256}
                      </p>
                      {run.result.detections.length === 0 ? (
                        <p>{t('ui.3a8215301197d890')}</p>
                      ) : (
                        <ul>
                          {run.result.detections.map((d, i) => (
                            <li key={i}>
                              {run.result!.classMap[d.classId]} {t('ui.af05f7133375d548')}
                              {d.score.toFixed(4)}
                            </li>
                          ))}
                        </ul>
                      )}
                      {run.reviewState === 'draft' && (
                        <div className="flex gap-3">
                          {(['confirmed', 'rejected'] as const).map((decision) => (
                            <button
                              key={decision}
                              disabled={!valid || busy}
                              onClick={() =>
                                void action(() =>
                                  apiClient.reviewClinicalImage(run.id, decision, reason),
                                )
                              }
                              className="rounded border px-3 py-2"
                            >
                              {decision === 'confirmed'
                                ? t('ui.758ccc4a8db3cc1e')
                                : t('ui.0eac35d479835c5c')}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </article>
              ))}
          </section>
        ))}
      </div>
    </main>
  );
}
