import type { ClinicalContent } from '@dentalai/contracts';
import { Field, SelectField } from './ClinicalFields';
type Risk = Extract<ClinicalContent, { kind: 'alert' | 'allergy' | 'medication' }>;
export function RiskEditor({ value, change }: { value: Risk; change: (value: Risk) => void }) {
  if (value.kind === 'alert')
    return (
      <>
        <Field
          label="Alert title"
          value={value.title}
          required
          onChange={(title) => change({ ...value, title })}
        />
        <Field
          label="Details"
          value={value.details ?? ''}
          onChange={(details) => change({ ...value, details: details || null })}
        />
        <SelectField
          label="Severity"
          value={value.severity}
          values={['info', 'warning', 'critical']}
          onChange={(v) => change({ ...value, severity: v as typeof value.severity })}
        />
        <label>
          <input
            type="checkbox"
            checked={value.active}
            onChange={(e) => change({ ...value, active: e.target.checked })}
          />{' '}
          Active alert
        </label>
      </>
    );
  if (value.kind === 'allergy')
    return (
      <>
        <Field
          label="Allergen or substance"
          value={value.substance}
          required
          onChange={(substance) => change({ ...value, substance })}
        />
        <Field
          label="Reaction"
          value={value.reaction ?? ''}
          onChange={(v) => change({ ...value, reaction: v || null })}
        />
        <Field
          label="Severity description"
          value={value.severity ?? ''}
          onChange={(v) => change({ ...value, severity: v || null })}
        />
        <SelectField
          label="Allergy status"
          value={value.status}
          values={['active', 'inactive', 'resolved', 'entered_in_error']}
          onChange={(v) => change({ ...value, status: v as typeof value.status })}
        />
      </>
    );
  return (
    <>
      <Field
        label="Medication name"
        value={value.medicationName}
        required
        onChange={(medicationName) => change({ ...value, medicationName })}
      />
      {(['dose', 'route', 'frequency'] as const).map((key) => (
        <Field
          key={key}
          label={key}
          value={value[key] ?? ''}
          onChange={(v) => change({ ...value, [key]: v || null })}
        />
      ))}
      <SelectField
        label="Medication status"
        value={value.status}
        values={['active', 'stopped', 'completed', 'entered_in_error']}
        onChange={(v) => change({ ...value, status: v as typeof value.status })}
      />
    </>
  );
}
