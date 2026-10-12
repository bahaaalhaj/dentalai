import { t } from '../i18n';
import type { ClinicalContent } from '@dentalai/contracts';
export function RecordView({ data }: { data: ClinicalContent }) {
  switch (data.kind) {
    case 'demographics':
      return (
        <p>
          {data.givenName} {data.familyName} · {data.preferredName} {t('ui.d71b7a38d6027641')}{' '}
          {data.dateOfBirth ?? 'not recorded'} · {data.phone} · {data.email}
        </p>
      );
    case 'note':
      return <p className="whitespace-pre-wrap">{data.body}</p>;
    case 'alert':
      return (
        <p>
          {data.title} — {data.severity} —{' '}
          {data.active ? t('ui.96879611650f80a8') : t('ui.dc676b42859915c8')} · {data.details}
        </p>
      );
    case 'allergy':
      return (
        <p>
          {data.substance} — {data.status} · {data.reaction} · {data.severity}
        </p>
      );
    case 'medication':
      return (
        <p>
          {data.medicationName} — {data.status} · {data.dose} · {data.route} · {data.frequency}
        </p>
      );
    case 'finding':
      return (
        <p>
          {t('ui.37f74f168b710c19')}
          {data.toothCode}: {data.findingCode} — {data.status} {t('ui.31fc1e9027707d25')}{' '}
          {data.surfaces.join(', ') || 'whole tooth / unspecified'} · {data.details}
        </p>
      );
    case 'procedure':
      return (
        <p>
          {data.procedureCode} — {data.status} {t('ui.080c7d61e3165748')}
          {data.toothCode ?? 'not applicable'} {t('ui.31fc1e9027707d25')}
          {data.surfaces.join(', ') || 'none'} · {data.description}
        </p>
      );
    case 'plan':
      return (
        <>
          <p>
            {data.name} — {data.status}
          </p>
          <ol>
            {data.items.map((item, i) => (
              <li key={i}>
                {item.description} {t('ui.080c7d61e3165748')}
                {item.toothCode ?? 'not applicable'} ({item.surfaces.join(', ')}) · {item.status}{' '}
                {t('ui.db84fd58edf34e24')}
                {item.quantity} · {item.estimatedAmountMinor} {item.currency}{' '}
                {t('ui.9c078d3ef6ec3e69')}
              </li>
            ))}
          </ol>
        </>
      );
  }
}
