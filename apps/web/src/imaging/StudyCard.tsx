import { t } from '../i18n';
import { displayStatus } from '../i18n/display';
import type { ImagingHistory } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { PrivatePreview } from './PrivatePreview';
export function StudyCard({
  image,
  history,
  capabilities,
  valid,
  busy,
  file,
  patient,
  reason,
  action,
  requestKey,
}: {
  image: ImagingHistory['images'][number];
  history: ImagingHistory;
  capabilities: Awaited<ReturnType<typeof apiClient.imagingCapabilities>> | undefined;
  valid: boolean;
  busy: boolean;
  file: File | undefined;
  patient: string;
  reason: string;
  action: (operation: () => Promise<unknown>) => Promise<void>;
  requestKey: (operation: string) => string;
}) {
  return (
    <section key={image.id} className="ui-card space-y-3">
      <h2 className="font-semibold">
        {t('ui.8f8cf9c6d47777cc')}
        {image.studyId} {t('ui.44f2bf202ba8f6ae')}
        {image.version}
      </h2>
      <PrivatePreview id={image.id} version={image.version} />
      <p className="ui-caption">
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
          onClick={() =>
            void action(() =>
              apiClient.analyzeClinicalImage(
                image.id,
                reason,
                requestKey(JSON.stringify(['analysis', image.id, reason])),
              ),
            )
          }
          className="rounded border px-3 py-2"
        >
          {t('ui.35345d03d2a60d42')}
        </button>
        <button
          disabled={!capabilities?.storageConfigured || !file || !valid || busy}
          onClick={() => {
            if (file)
              void action(() =>
                apiClient.uploadClinicalImage(
                  patient,
                  file,
                  reason,
                  image.studyId,
                  requestKey(
                    JSON.stringify([
                      'upload',
                      patient,
                      image.studyId,
                      reason,
                      file.name,
                      file.size,
                      file.lastModified,
                    ]),
                  ),
                ),
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
              {displayStatus(run.status)} {t('ui.7837d5cddbc3e1a8')}
              {displayStatus(run.reviewState)}
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
                          void action(() => apiClient.reviewClinicalImage(run.id, decision, reason))
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
  );
}
