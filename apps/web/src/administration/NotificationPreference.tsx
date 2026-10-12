import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { t } from '../i18n';
export function NotificationPreference() {
  const [value, setValue] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiClient
      .notificationPreferences()
      .then((result) => {
        if (active) setValue(result.operationalEmail);
      })
      .catch((error) => {
        if (active) setError(getErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section>
      <h2>{t('admin.preferences')}</h2>
      {error && <p role="alert">{error}</p>}
      <label>
        <input
          type="checkbox"
          disabled={value === null || busy}
          checked={value ?? false}
          onChange={async (e) => {
            setBusy(true);
            setError('');
            try {
              const response = await apiClient.notificationPreferences(e.target.checked);
              setValue(response.operationalEmail);
            } catch (error) {
              setError(getErrorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        />
        {t('admin.emailPreference')}
      </label>
      <p>{t('admin.requiredEmails')}</p>
    </section>
  );
}
