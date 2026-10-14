import { useState } from 'react';
import { t } from '../i18n';
export function PrivatePreview({ id, version }: { id: string; version: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="ui-study-image">
      {failed ? (
        <div role="status">
          <p>{t('polish.previewUnavailable')}</p>
          <button className="ui-btn-secondary" onClick={() => setFailed(false)}>
            {t('polish.retry')}
          </button>
        </div>
      ) : (
        <img
          src={`/api/v1/imaging/images/${id}/content`}
          loading="lazy"
          alt={t('polish.privatePreview', { version })}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
