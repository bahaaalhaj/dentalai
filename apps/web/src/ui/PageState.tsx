import { Inbox, LoaderCircle, AlertCircle } from 'lucide-react';
import { t } from '../i18n';
export function PageState({
  title,
  description,
  loading = false,
  error = false,
  retry,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  error?: boolean;
  retry?: () => void;
}) {
  const Icon = loading ? LoaderCircle : error ? AlertCircle : Inbox;
  return (
    <section className="ui-empty-state" role={error ? 'alert' : loading ? 'status' : undefined}>
      <span className="ui-empty-icon">
        <Icon aria-hidden="true" size={24} />
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {retry && (
        <button className="ui-btn-secondary" onClick={retry}>
          {t('polish.retry')}
        </button>
      )}
    </section>
  );
}
