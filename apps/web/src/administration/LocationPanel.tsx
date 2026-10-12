import { useState } from 'react';
import type { z } from 'zod';
import type { LocationSchema, LocationWriteSchema } from '@dentalai/contracts';
import { Field } from '../clinical/ClinicalFields';
import { t } from '../i18n';
type Location = z.infer<typeof LocationSchema>;
export function LocationPanel({
  locations,
  timezone,
  busy,
  save,
}: {
  locations: Location[];
  timezone: string;
  busy: boolean;
  save: (value: z.infer<typeof LocationWriteSchema>) => Promise<void>;
}) {
  return (
    <section className="bg-white border rounded-2xl p-5 space-y-3">
      <h2 className="font-bold">{t('admin.locations')}</h2>
      {locations.map((location) => (
        <LocationForm key={JSON.stringify(location)} initial={location} busy={busy} save={save} />
      ))}
      <LocationForm
        initial={{ name: '', timezone, address: null, phone: null, active: true }}
        busy={busy}
        save={save}
      />
    </section>
  );
}
function LocationForm({
  initial,
  busy,
  save,
}: {
  initial: Omit<Location, 'id'> & { id?: string };
  busy: boolean;
  save: (value: z.infer<typeof LocationWriteSchema>) => Promise<void>;
}) {
  const [value, setValue] = useState(initial),
    [reason, setReason] = useState('');
  return (
    <form
      className="border p-3 rounded-xl grid sm:grid-cols-2 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ ...value, reason });
      }}
    >
      <Field
        label={t('admin.locations')}
        value={value.name}
        required
        onChange={(name) => setValue({ ...value, name })}
      />
      <Field
        label={t('admin.timezone')}
        value={value.timezone}
        required
        onChange={(timezone) => setValue({ ...value, timezone })}
      />
      <Field
        label={t('admin.address')}
        value={value.address ?? ''}
        onChange={(address) => setValue({ ...value, address: address || null })}
      />
      <Field
        label={t('admin.phone')}
        value={value.phone ?? ''}
        onChange={(phone) => setValue({ ...value, phone: phone || null })}
      />
      <label>
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        {t('admin.active')}
      </label>
      <Field label={t('admin.reason')} value={reason} required onChange={setReason} />
      <button disabled={busy || reason.trim().length < 3}>
        {t(value.id ? 'admin.locationSave' : 'admin.locationAdd')}
      </button>
    </form>
  );
}
