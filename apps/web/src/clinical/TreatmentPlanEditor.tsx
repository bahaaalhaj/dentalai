import { t } from '../i18n';
import type { ClinicalContent, ClinicalWorkspace } from '@dentalai/contracts';
import { Field, SelectField } from './ClinicalFields';
import { SurfacePicker } from './Odontogram';
type Plan = Extract<ClinicalContent, { kind: 'plan' }>;
export function TreatmentPlanEditor({
  value,
  change,
  services,
}: {
  value: Plan;
  change: (value: Plan) => void;
  services: ClinicalWorkspace['services'];
}) {
  const blank = () =>
    ({
      serviceId: services[0]?.id ?? '',
      toothCode: null,
      surfaces: [],
      description: '',
      quantity: 1,
      estimatedAmountMinor: 0,
      currency: 'USD',
      status: 'planned',
    }) as Plan['items'][number];
  return (
    <>
      <Field
        label={t('ui.c0657726a594cea6')}
        required
        value={value.name}
        onChange={(name) => change({ ...value, name })}
      />
      <SelectField
        label={t('ui.a0630ab64bd94fff')}
        value={value.status}
        values={[
          'draft',
          'presented',
          'accepted',
          'rejected',
          'in_progress',
          'completed',
          'cancelled',
        ]}
        onChange={(v) => change({ ...value, status: v as Plan['status'] })}
      />
      {!services.length && <p role="status">{t('ui.7300bda71196b415')}</p>}
      {value.items.map((item, index) => {
        const update = (next: typeof item) =>
          change({ ...value, items: value.items.map((v, i) => (i === index ? next : v)) });
        return (
          <fieldset key={index} className="border p-4 rounded-xl space-y-3">
            <legend>
              {t('ui.bc18acbc055b61d2')}
              {index + 1}
            </legend>
            <label className="block">
              {t('ui.d677190e0a9990e7')}
              <select
                className="w-full p-3 border rounded"
                value={item.serviceId}
                onChange={(e) => update({ ...item, serviceId: e.target.value })}
                required
              >
                <option value="">{t('ui.75c533071d945d84')}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={t('ui.89ed70057cf8af99')}
              required
              value={item.description}
              onChange={(description) => update({ ...item, description })}
            />
            <Field
              label={t('ui.9d2197021a64db4f')}
              value={item.toothCode ?? ''}
              onChange={(v) => update({ ...item, toothCode: v || null, surfaces: [] })}
            />
            <SurfacePicker
              toothCode={item.toothCode}
              surfaces={item.surfaces}
              change={(surfaces) => update({ ...item, surfaces })}
            />
            <Field
              label={t('ui.822bab8d41bca8d7')}
              type="number"
              value={String(item.quantity)}
              onChange={(v) => update({ ...item, quantity: Number(v) })}
            />
            <Field
              label={t('ui.f93ec4977b727d89')}
              type="number"
              value={String(item.estimatedAmountMinor)}
              onChange={(v) => update({ ...item, estimatedAmountMinor: Number(v) })}
            />
            <Field
              label={t('ui.c2a354bdcfff39b7')}
              value={item.currency}
              onChange={(currency) => update({ ...item, currency })}
            />
            <SelectField
              label={t('ui.872bbbfbc4dc2991')}
              value={item.status}
              values={['planned', 'in_progress', 'completed', 'cancelled', 'entered_in_error']}
              onChange={(v) => update({ ...item, status: v as typeof item.status })}
            />
            <button
              type="button"
              className="text-red-700"
              onClick={() => change({ ...value, items: value.items.filter((_, i) => i !== index) })}
            >
              {t('ui.d9b1c20e7d8e85b9')}
              {index + 1}
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        className="text-indigo-600"
        onClick={() => change({ ...value, items: [...value.items, blank()] })}
      >
        {t('ui.f69ee4a6769235d8')}
      </button>
    </>
  );
}
