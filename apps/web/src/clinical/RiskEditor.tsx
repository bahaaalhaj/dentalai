import { t } from '../i18n';
import type { ClinicalContent } from '@dentalai/contracts';
import { Field, SelectField } from './ClinicalFields';
type Risk = Extract<ClinicalContent, { kind: 'alert' | 'allergy' | 'medication' }>;
export function RiskEditor({ value, change }: { value: Risk; change: (value: Risk) => void }) {
  if (value.kind === 'alert')
    return (
      <>
        <Field
          label={t('ui.cca733381e1afe54')}
          value={value.title}
          required
          onChange={(title) => change({ ...value, title })}
        />
        <Field
          label={t('ui.45989de49fb7f66d')}
          value={value.details ?? ''}
          onChange={(details) => change({ ...value, details: details || null })}
        />
        <SelectField
          label={t('ui.5e9f98120dbe5682')}
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
          {t('ui.c56c69f95ff515bd')}
        </label>
      </>
    );
  if (value.kind === 'allergy')
    return (
      <>
        <Field
          label={t('ui.8c0adbafe6da11c1')}
          value={value.substance}
          required
          onChange={(substance) => change({ ...value, substance })}
        />
        <Field
          label={t('ui.d8be728bfd055a85')}
          value={value.reaction ?? ''}
          onChange={(v) => change({ ...value, reaction: v || null })}
        />
        <Field
          label={t('ui.53129597fb9b9d64')}
          value={value.severity ?? ''}
          onChange={(v) => change({ ...value, severity: v || null })}
        />
        <SelectField
          label={t('ui.0266dab23314e916')}
          value={value.status}
          values={['active', 'inactive', 'resolved', 'entered_in_error']}
          onChange={(v) => change({ ...value, status: v as typeof value.status })}
        />
      </>
    );
  return (
    <>
      <Field
        label={t('ui.376f8b8403a0ba23')}
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
        label={t('ui.e80a60c7af2197fd')}
        value={value.status}
        values={['active', 'stopped', 'completed', 'entered_in_error']}
        onChange={(v) => change({ ...value, status: v as typeof value.status })}
      />
    </>
  );
}
