import type { ClinicFieldsValue } from './initial-clinic';
import { Field } from '../clinical/ClinicalFields';
import { t } from '../i18n';
export function ClinicFields({
  value,
  onChange,
  identityOnly = false,
}: {
  value: ClinicFieldsValue;
  onChange: (value: ClinicFieldsValue) => void;
  identityOnly?: boolean;
}) {
  const update = <K extends keyof ClinicFieldsValue>(key: K, next: ClinicFieldsValue[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field
        label={t('admin.legalName')}
        value={value.legalName}
        onChange={(v) => update('legalName', v)}
        required
      />
      <Field
        label={t('admin.displayName')}
        value={value.displayName}
        onChange={(v) => update('displayName', v)}
        required
      />
      {!identityOnly && (
        <>
          <Field
            label={t('admin.currency')}
            value={value.currency}
            onChange={(v) => update('currency', v.toUpperCase())}
            required
          />
          <Field
            label={t('admin.timezone')}
            value={value.timezone}
            onChange={(v) => update('timezone', v)}
            required
          />
          <label>
            {t('admin.locale')}
            <select
              className="block border rounded-xl p-3 w-full"
              value={value.locale}
              onChange={(e) => update('locale', e.target.value === 'ar' ? 'ar' : 'en')}
            >
              <option value="en">{t('ui.ba118bf7fc9c1aed')}</option>
              <option value="ar">{t('ui.d274159863057eb5')}</option>
            </select>
          </label>
          <Field
            label={t('admin.email')}
            type="email"
            value={value.contactEmail ?? ''}
            onChange={(v) => update('contactEmail', v || null)}
          />
          <Field
            label={t('admin.phone')}
            value={value.contactPhone ?? ''}
            onChange={(v) => update('contactPhone', v || null)}
          />
          <Field
            label={t('admin.color')}
            type="color"
            value={value.brandColor}
            onChange={(v) => update('brandColor', v)}
          />
          <Field
            label={t('admin.mark')}
            value={value.brandMark}
            onChange={(v) => update('brandMark', v)}
            required
          />
        </>
      )}
    </div>
  );
}
