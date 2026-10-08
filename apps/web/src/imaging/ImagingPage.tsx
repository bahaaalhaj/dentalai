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
        if (active) setError('Private imaging configuration is unavailable. Reload to retry.');
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
        if (active) setError('Patient directory unavailable. Reload to retry.');
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
        if (active) setError('Image history unavailable. Reselect the patient to retry.');
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
      setNotice('Saved. Previous image and analysis history is retained.');
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
          Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold">Private X-ray studies</h1>
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          Experimental decision support. Not clinically validated; do not use for patient-care
          decisions. Scores are model outputs, not calibrated probabilities. A clinician review does
          not establish system validation.
        </p>
        {capabilities && !capabilities.storageConfigured && (
          <p role="status">
            Private image storage is unavailable pending technical and clinical validation and
            explicit server configuration.
          </p>
        )}
        {capabilities && !capabilities.inferenceConfigured && (
          <p role="status">
            X-ray inference is unavailable pending technical and clinical validation. No findings
            will be generated.
          </p>
        )}
        <label className="block">
          Patient
          <select
            value={patient}
            onChange={(e) => setPatient(e.target.value)}
            disabled={busy}
            className="ml-3 rounded border p-2"
          >
            <option value="">Select patient</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.givenName} {p.familyName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Reason for upload, analysis or review
          <input
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded border p-2"
          />
        </label>
        {!valid && (
          <p className="text-sm">
            Enter a reason of 3–500 characters before changing a clinical image record.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (file) void action(() => apiClient.uploadClinicalImage(patient, file, reason));
          }}
          className="rounded-xl bg-white p-4"
        >
          <label>
            PNG/JPEG image (maximum 10 MiB)
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
            Upload as new study
          </button>
        </form>
        {busy && <p role="status">Saving…</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {patient && !history && !error && <p role="status">Loading image history…</p>}
        {history?.images.length === 0 && <p>No private image studies have been uploaded.</p>}
        {history?.images.map((image) => (
          <section key={image.id} className="space-y-3 rounded-xl border bg-white p-4">
            <h2 className="font-semibold">
              Study {image.studyId} — image version {image.version}
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
              Open private image
            </a>
            <div className="flex gap-3">
              <button
                disabled={!capabilities?.inferenceConfigured || !valid || busy}
                onClick={() => void action(() => apiClient.analyzeClinicalImage(image.id, reason))}
                className="rounded border px-3 py-2"
              >
                Request experimental analysis
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
                Upload selected file as next version
              </button>
            </div>
            {history.analyses
              .filter((r) => r.imageId === image.id)
              .map((run) => (
                <article key={run.id} className="rounded border p-3">
                  <h3>
                    Analysis: {run.status} · Review: {run.reviewState}
                  </h3>
                  {run.errorCode && (
                    <p>
                      No findings generated: inference unavailable. Configure an approved versioned
                      model and retry with a new run.
                    </p>
                  )}
                  {run.result && (
                    <>
                      <p>
                        Model {run.result.modelName} / {run.result.modelVersion} ·{' '}
                        {run.result.latencyMs.toFixed(1)} ms
                      </p>
                      <p className="break-all text-xs">
                        Artifact SHA-256: {run.result.artifactSha256}
                      </p>
                      {run.result.detections.length === 0 ? (
                        <p>
                          The model returned no detections. This does not establish absence of
                          disease.
                        </p>
                      ) : (
                        <ul>
                          {run.result.detections.map((d, i) => (
                            <li key={i}>
                              {run.result!.classMap[d.classId]} — model score {d.score.toFixed(4)}
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
                              {decision === 'confirmed' ? 'Confirm findings' : 'Reject findings'}
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
