import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { Field } from '../clinical/ClinicalFields';
import { ClinicFields } from './ClinicFields';
import { initialClinic } from './initial-clinic';
import { t } from '../i18n';
export function OnboardingPage({ refresh }: { refresh: () => Promise<void> }) {
  const [value, setValue] = useState(initialClinic),
    [slug, setSlug] = useState(''),
    [locationName, setLocation] = useState(''),
    [step, setStep] = useState(1),
    [authority, setAuthority] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <Link to="/dashboard">{t('admin.home')}</Link>
        <section className="bg-white p-6 rounded-3xl border space-y-4">
          <h1 className="text-2xl font-bold">{t('admin.onboard')}</h1>
          <nav aria-label={t('admin.onboard')} className="flex flex-wrap gap-4">
            <span aria-current={step === 1 ? 'step' : undefined}>{t('admin.onboard1')}</span>
            <span aria-current={step === 2 ? 'step' : undefined}>{t('admin.onboard2')}</span>
            <span aria-current={step === 3 ? 'step' : undefined}>{t('admin.onboard3')}</span>
          </nav>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (step < 3) {
                setStep(step + 1);
                return;
              }
              void (async () => {
                setBusy(true);
                setError('');
                try {
                  await apiClient.onboard({
                    ...value,
                    slug,
                    locationName,
                    authorityConfirmed: true,
                  });
                  await refresh();
                  window.location.assign('/administration');
                } catch (error) {
                  setError(getErrorMessage(error));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {step === 1 && (
              <>
                <ClinicFields value={value} onChange={setValue} identityOnly />
                <Field label={t('admin.slug')} value={slug} onChange={setSlug} required />
                <Field
                  label={t('admin.location')}
                  value={locationName}
                  onChange={setLocation}
                  required
                />
              </>
            )}
            {step === 2 && <ClinicFields value={value} onChange={setValue} />}
            {step === 3 && (
              <>
                <dl className="space-y-2">
                  <dt>{t('admin.displayName')}</dt>
                  <dd>{value.displayName}</dd>
                  <dt>{t('admin.currency')}</dt>
                  <dd dir="ltr">{value.currency}</dd>
                  <dt>{t('admin.timezone')}</dt>
                  <dd dir="ltr">{value.timezone}</dd>
                </dl>
                <p className="rounded-xl bg-amber-50 p-3">{t('admin.trial')}</p>
                <label className="block">
                  <input
                    type="checkbox"
                    required
                    checked={authority}
                    onChange={(e) => setAuthority(e.target.checked)}
                  />{' '}
                  {t('admin.authority')}
                </label>
              </>
            )}
            {step > 1 && (
              <button type="button" disabled={busy} onClick={() => setStep(step - 1)}>
                {t('admin.back')}
              </button>
            )}{' '}
            <button
              className="bg-indigo-600 text-white px-5 py-3 rounded-xl disabled:opacity-50"
              disabled={busy || (step === 3 && !authority)}
            >
              {step === 3 ? t('admin.create') : t('admin.next')}
            </button>
            {error && <p role="alert">{error}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
