import { t } from '../i18n';
import type { ClinicalContent, ClinicalRecord } from '@dentalai/contracts';
import { Field, SelectField } from './ClinicalFields';

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
export function Odontogram({
  records,
  select,
}: {
  records: Pick<ClinicalRecord, 'data'>[];
  select?: (tooth: string) => void;
}) {
  const rows = [
    [1, 2, 8],
    [4, 3, 8],
    [5, 6, 5],
    [8, 7, 5],
  ] as const;
  return (
    <section
      aria-label={t('ui.d27a92a5853e6770')}
      className="rounded-2xl border bg-white p-5 space-y-3"
    >
      <h2 className="font-bold">{t('ui.16afbf9956d84ea5')}</h2>
      <p className="text-sm text-slate-500">{t('ui.807d7b25f46bfb23')}</p>
      {rows.map(([right, left, count]) => (
        <div dir="ltr" key={right} className="flex flex-wrap gap-1">
          {[
            ...Array.from({ length: count }, (_, i) => `${right}${count - i}`),
            ...Array.from({ length: count }, (_, i) => `${left}${i + 1}`),
          ].map((tooth) => {
            const findings = records.filter(
              (r) =>
                r.data.kind === 'finding' &&
                r.data.toothCode === tooth &&
                r.data.status !== 'entered_in_error',
            );
            const label = `Tooth ${tooth}: ${findings.length ? findings.map((r) => (r.data.kind === 'finding' ? `${r.data.status === 'resolved' ? 'resolved ' : ''}${r.data.findingCode}` : '')).join(', ') : 'unrecorded'}`;
            return select ? (
              <button
                type="button"
                key={tooth}
                aria-label={label}
                onClick={() => select(tooth)}
                className={`p-2 rounded border focus:ring-2 focus:ring-indigo-500 ${findings.length ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50'}`}
              >
                {tooth}
              </button>
            ) : (
              <span key={tooth} aria-label={label} className="p-2 rounded border bg-slate-50">
                {tooth}
              </span>
            );
          })}
        </div>
      ))}
    </section>
  );
}
