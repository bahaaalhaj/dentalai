import { displayStatus } from '../i18n/display';
export function StatusBadge({ value }: { value: string }) {
  return (
    <span className="ui-status-badge" data-status={value}>
      {displayStatus(value)}
    </span>
  );
}
