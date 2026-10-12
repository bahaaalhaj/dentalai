import { setLocale, t, useLocale } from './index';
export function LanguageControl() {
  const locale = useLocale();
  return (
    <aside className="fixed bottom-4 end-4 z-50 rounded-xl bg-white border border-slate-200 p-2 shadow-md">
      <label>
        {t('language')}{' '}
        <select
          aria-label={t('language')}
          value={locale}
          onChange={(event) => setLocale(event.target.value === 'ar' ? 'ar' : 'en')}
        >
          <option value="en">{t('english')}</option>
          <option value="ar">{t('arabic')}</option>
        </select>
      </label>
    </aside>
  );
}
