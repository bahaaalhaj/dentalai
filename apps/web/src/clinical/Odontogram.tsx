import { t } from '../i18n';
import type { ClinicalContent } from '@dentalai/contracts';
import { Field, SelectField } from './ClinicalFields';
export { Odontogram } from './GraphicalOdontogram';

type Dental = Extract<ClinicalContent, { kind: 'finding' | 'procedure' }>;
export function SurfacePicker({
  toothCode,
  surfaces,
  change,
}: {
  toothCode: string | null;
  surfaces: Dental['surfaces'];
  change: (surfaces: Dental['surfaces']) => void;
}) {
  const allowed: Dental['surfaces'] =
    toothCode && Number(toothCode[1]) <= 3 ? ['M', 'D', 'I', 'F', 'L'] : ['M', 'D', 'O', 'B', 'L'];
  return (
    <fieldset className="flex flex-wrap gap-4">
      <legend className="mb-2">{t('ui.826dd9340074fa74')}</legend>
      {allowed.map((s) => (
        <label key={s}>
          <input
            type="checkbox"
            checked={surfaces.includes(s)}
            onChange={(e) =>
              change(e.target.checked ? [...surfaces, s] : surfaces.filter((v) => v !== s))
            }
          />{' '}
          {s}
        </label>
      ))}
    </fieldset>
  );
}
export function OdontogramEditor({
  value,
  change,
  actionChosen,
  chooseAction,
}: {
  value: Dental;
  change: (value: Dental) => void;
  actionChosen: boolean;
  chooseAction: () => void;
}) {
  return (
    <>
      <Field
        label={t('ui.6833382609f30ccd')}
        required={value.kind === 'finding' || value.procedureCode !== 'other'}
        value={value.toothCode ?? ''}
        onChange={(v) =>
          change(
            value.kind === 'finding'
              ? { ...value, toothCode: v, surfaces: [] }
              : { ...value, toothCode: v || null, surfaces: [] },
          )
        }
      />
      <SurfacePicker
        toothCode={value.toothCode}
        surfaces={value.surfaces}
        change={(surfaces) => change({ ...value, surfaces })}
      />
      {value.kind === 'finding' ? (
        <>
          <SelectField
            label={t('ui.36f5412836df27fd')}
            value={actionChosen ? value.findingCode : ''}
            placeholder={t('ui.cd06f79c2c0a5124')}
            values={[
              'healthy',
              'caries',
              'missing',
              'restoration',
              'fracture',
              'periapical_lesion',
            ]}
            onChange={(v) => {
              chooseAction();
              change({ ...value, findingCode: v as typeof value.findingCode });
            }}
          />
          <SelectField
            label={t('ui.8305745743d971ee')}
            value={value.status}
            values={['active', 'resolved', 'entered_in_error']}
            onChange={(v) => change({ ...value, status: v as typeof value.status })}
          />
          <Field
            label={t('ui.0d59110897709f34')}
            value={value.details ?? ''}
            onChange={(v) => change({ ...value, details: v || null })}
          />
        </>
      ) : (
        <>
          <SelectField
            label={t('ui.38d9804acb4c2c9d')}
            value={actionChosen ? value.procedureCode : ''}
            placeholder={t('ui.532f70b4f3d85cd9')}
            values={['restoration', 'extraction', 'root_canal', 'crown', 'implant', 'other']}
            onChange={(v) => {
              chooseAction();
              change({ ...value, procedureCode: v as typeof value.procedureCode });
            }}
          />
          <SelectField
            label={t('ui.7ada488b2b391916')}
            value={value.status}
            values={['planned', 'in_progress', 'completed', 'cancelled', 'entered_in_error']}
            onChange={(v) => change({ ...value, status: v as typeof value.status })}
          />
          <Field
            label={t('ui.364a3ebcee4bb09c')}
            value={value.description}
            required
            onChange={(description) => change({ ...value, description })}
          />
        </>
      )}
    </>
  );
}
