import type { ClinicalContent } from '@dentalai/contracts';
export function RecordView({ data }: { data: ClinicalContent }) {
  switch (data.kind) {
    case 'demographics':
      return (
        <p>
          {data.givenName} {data.familyName} · {data.preferredName} · born{' '}
          {data.dateOfBirth ?? 'not recorded'} · {data.phone} · {data.email}
        </p>
      );
    case 'note':
      return <p className="whitespace-pre-wrap">{data.body}</p>;
    case 'alert':
      return (
        <p>
          {data.title} — {data.severity} — {data.active ? 'active' : 'resolved'} · {data.details}
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
          Tooth {data.toothCode}: {data.findingCode} — {data.status} · surfaces{' '}
          {data.surfaces.join(', ') || 'whole tooth / unspecified'} · {data.details}
        </p>
      );
    case 'procedure':
      return (
        <p>
          {data.procedureCode} — {data.status} · tooth {data.toothCode ?? 'not applicable'} ·
          surfaces {data.surfaces.join(', ') || 'none'} · {data.description}
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
                {item.description} · tooth {item.toothCode ?? 'not applicable'} (
                {item.surfaces.join(', ')}) · {item.status} · quantity {item.quantity} ·{' '}
                {item.estimatedAmountMinor} {item.currency} minor units
              </li>
            ))}
          </ol>
        </>
      );
  }
}
