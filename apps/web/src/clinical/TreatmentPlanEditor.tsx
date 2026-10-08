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
        label="Plan name"
        required
        value={value.name}
        onChange={(name) => change({ ...value, name })}
      />
      <SelectField
        label="Plan status"
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
      {!services.length && (
        <p role="status">
          No active services are configured. A treatment plan cannot be saved yet.
        </p>
      )}
      {value.items.map((item, index) => {
        const update = (next: typeof item) =>
          change({ ...value, items: value.items.map((v, i) => (i === index ? next : v)) });
        return (
          <fieldset key={index} className="border p-4 rounded-xl space-y-3">
            <legend>Plan item {index + 1}</legend>
            <label className="block">
              Service
              <select
                className="w-full p-3 border rounded"
                value={item.serviceId}
                onChange={(e) => update({ ...item, serviceId: e.target.value })}
                required
              >
                <option value="">Select service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Item description"
              required
              value={item.description}
              onChange={(description) => update({ ...item, description })}
            />
            <Field
              label="Item FDI tooth"
              value={item.toothCode ?? ''}
              onChange={(v) => update({ ...item, toothCode: v || null, surfaces: [] })}
            />
            <SurfacePicker
              toothCode={item.toothCode}
              surfaces={item.surfaces}
              change={(surfaces) => update({ ...item, surfaces })}
            />
            <Field
              label="Quantity"
              type="number"
              value={String(item.quantity)}
              onChange={(v) => update({ ...item, quantity: Number(v) })}
            />
            <Field
              label="Estimate in minor units"
              type="number"
              value={String(item.estimatedAmountMinor)}
              onChange={(v) => update({ ...item, estimatedAmountMinor: Number(v) })}
            />
            <Field
              label="Currency (ISO code)"
              value={item.currency}
              onChange={(currency) => update({ ...item, currency })}
            />
            <SelectField
              label="Item status"
              value={item.status}
              values={['planned', 'in_progress', 'completed', 'cancelled', 'entered_in_error']}
              onChange={(v) => update({ ...item, status: v as typeof item.status })}
            />
            <button
              type="button"
              className="text-red-700"
              onClick={() => change({ ...value, items: value.items.filter((_, i) => i !== index) })}
            >
              Remove unsaved item {index + 1}
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        className="text-indigo-600"
        onClick={() => change({ ...value, items: [...value.items, blank()] })}
      >
        Add plan item
      </button>
    </>
  );
}
