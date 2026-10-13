import { t } from './i18n';
import { useState } from 'react';
import { localWallTimeToInstant } from '@dentalai/domain';
import { formatAppointmentTime } from './appointment-format';
import type { SchedulingCatalog } from '@dentalai/contracts';
import { apiClient } from './lib/api-client';
import { input, button } from './appointment-shared';

export function SchedulingSettings({
  catalog,
  reload,
  run,
  busy,
}: {
  catalog: SchedulingCatalog;
  reload: () => Promise<void>;
  run: (operation: () => Promise<unknown>, message: string) => Promise<void>;
  busy: boolean;
}) {
  const [locationId, setLocationId] = useState(catalog.locations[0]?.id ?? '');
  const [providerId, setProviderId] = useState('');
  const [day, setDay] = useState(1);
  const [opens, setOpens] = useState('09:00');
  const [closes, setCloses] = useState('17:00');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [duration, setDuration] = useState(30);
  const [chair, setChair] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [clinicWide, setClinicWide] = useState(false);
  const [lead, setLead] = useState(catalog.policy.leadMinutes);
  const [horizon, setHorizon] = useState(catalog.policy.horizonDays);
  const save = (operation: () => Promise<unknown>, message: string) =>
    void run(async () => {
      await operation();
      await reload();
    }, message);
  const timezone = clinicWide
    ? catalog.clinicTimezone
    : (catalog.locations.find((item) => item.id === locationId)?.timezone ??
      catalog.clinicTimezone);
  return (
    <details className="bg-white rounded-3xl border border-slate-200 p-6">
      <summary className="font-bold cursor-pointer">{t('ui.3e7291e7ec1a268d')}</summary>
      <div className="space-y-6 mt-5">
        <p>{t('ui.8bfd2804ee08109c')}</p>
        <p>
          {t('ui.1240121f112ab1e5')}{' '}
          {catalog.providers.map((item) => item.name).join(', ') || t('fallback.noProvider')}
        </p>
        <label className="block">
          {t('ui.02b9235c82dc2be5')}
          <select
            aria-label={t('ui.02b9235c82dc2be5')}
            className={input}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            {catalog.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.timezone})
              </option>
            ))}
          </select>
        </label>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () => apiClient.addOperatory({ locationId, name: chair }),
              t('ui.0fcaec6261aa6b0b'),
            );
          }}
        >
          <h2 className="font-bold">{t('ui.09e99d8899cd6b72')}</h2>
          <p>{catalog.operatories.map((item) => item.name).join(', ')}</p>
          <label>
            {t('ui.1fb26001874e53a3')}
            <input
              aria-label={t('ui.1fb26001874e53a3')}
              className={input}
              required
              value={chair}
              onChange={(event) => setChair(event.target.value)}
            />
          </label>
          <button disabled={busy || !locationId} className={button}>
            {t('ui.ad7f1a27842a9254')}
          </button>
        </form>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () => apiClient.addAppointmentType({ name, code, durationMinutes: duration }),
              t('ui.dceafe50af037cfa'),
            );
          }}
        >
          <h2 className="font-bold">{t('ui.23a7da3b244aca3b')}</h2>
          <label>
            {t('ui.795dfd0ae966023b')}
            <input
              aria-label={t('ui.795dfd0ae966023b')}
              className={input}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {t('ui.936997b9e45eb31d')}
            <input
              aria-label={t('ui.936997b9e45eb31d')}
              className={input}
              required
              pattern="[a-z0-9_-]+"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label>
            {t('ui.91d7528868594410')}
            <input
              aria-label={t('ui.91d7528868594410')}
              className={input}
              type="number"
              min={5}
              max={480}
              required
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </label>
          <button disabled={busy} className={button}>
            {t('ui.60f7694e9cd6a414')}
          </button>
        </form>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () =>
                apiClient.addWorkingHours({
                  locationId,
                  providerId: providerId || null,
                  weekday: day,
                  opensAt: opens,
                  closesAt: closes,
                }),
              t('ui.a8310262a7fc350a'),
            );
          }}
        >
          <h2 className="font-bold">{t('ui.b9c635214e54995c')}</h2>
          <label>
            {t('ui.5069e7f0488d64bb')}
            <select
              aria-label={t('ui.a948c08b17deaef2')}
              className={input}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              <option value="">{t('ui.4300e645fce54f7b')}</option>
              {catalog.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('ui.6ff81986ead18583')}
            <select
              aria-label={t('ui.7f2b9a81dc91b5cf')}
              className={input}
              value={day}
              onChange={(event) => setDay(Number(event.target.value))}
            >
              {(
                [
                  'weekday.0',
                  'weekday.1',
                  'weekday.2',
                  'weekday.3',
                  'weekday.4',
                  'weekday.5',
                  'weekday.6',
                ] as const
              ).map((key, index) => (
                <option key={key} value={index}>
                  {t(key)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('ui.21a71f3e3356eeab')}
            <input
              aria-label={t('ui.21a71f3e3356eeab')}
              className={input}
              type="time"
              required
              value={opens}
              onChange={(event) => setOpens(event.target.value)}
            />
          </label>
          <label>
            {t('ui.74c21a6312ede178')}
            <input
              aria-label={t('ui.74c21a6312ede178')}
              className={input}
              type="time"
              required
              value={closes}
              onChange={(event) => setCloses(event.target.value)}
            />
          </label>
          <button disabled={busy || !locationId} className={button}>
            {t('ui.260f780d01164dfa')}
          </button>
        </form>
        {catalog.hours.map((hour) => (
          <div key={hour.id}>
            {t(
              (
                [
                  'weekday.0',
                  'weekday.1',
                  'weekday.2',
                  'weekday.3',
                  'weekday.4',
                  'weekday.5',
                  'weekday.6',
                ] as const
              )[hour.weekday]!,
            )}{' '}
            {hour.opensAt}–{hour.closesAt} ·{' '}
            {hour.providerId ? t('ui.472590ae974d4c1f') : t('ui.2962cc236751bea3')}
            <button
              disabled={busy}
              onClick={() =>
                save(() => apiClient.removeWorkingHours(hour.id), t('ui.a56dd261df447c85'))
              }
            >
              {t('ui.337419027e9f3105')}
            </button>
          </div>
        ))}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () =>
                apiClient.addClosure({
                  locationId: clinicWide ? null : locationId,
                  startsAt: localWallTimeToInstant(start, timezone),
                  endsAt: localWallTimeToInstant(end, timezone),
                  reason,
                }),
              t('ui.6405660706902edc'),
            );
          }}
        >
          <h2 className="font-bold">
            {t('ui.775cc873b0bd3ba0')}
            {timezone})
          </h2>
          <label>
            <input
              type="checkbox"
              checked={clinicWide}
              onChange={(event) => setClinicWide(event.target.checked)}
            />
            {t('ui.988b9fdb3e344d25')}
          </label>
          <label>
            {t('ui.92688441a96d721f')}
            <input
              aria-label={t('ui.92688441a96d721f')}
              className={input}
              type="datetime-local"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            {t('ui.fe6ba80577d6a05b')}
            <input
              aria-label={t('ui.fe6ba80577d6a05b')}
              className={input}
              type="datetime-local"
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label>
            {t('ui.7ebd2ce1d37c69d0')}
            <input
              aria-label={t('ui.7ebd2ce1d37c69d0')}
              className={input}
              maxLength={500}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button disabled={busy} className={button}>
            {t('ui.89af5fefa763e644')}
          </button>
        </form>
        {catalog.closures.map((closure) => (
          <div key={closure.id}>
            {formatAppointmentTime(closure.startsAt, catalog.clinicTimezone)} · {closure.reason}
            <button
              disabled={busy}
              onClick={() =>
                save(() => apiClient.removeClosure(closure.id), t('ui.d2fd23c32411effd'))
              }
            >
              {t('ui.1400f848bd0a0e50')}
            </button>
          </div>
        ))}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () => apiClient.setSchedulingPolicy({ leadMinutes: lead, horizonDays: horizon }),
              t('ui.b442f8f9a07cb022'),
            );
          }}
        >
          <h2 className="font-bold">{t('ui.88758c613cea9455')}</h2>
          <label>
            {t('ui.aef58ccf126d8918')}
            <input
              aria-label={t('ui.4cfaa9df90c53d55')}
              className={input}
              type="number"
              min={0}
              max={10080}
              value={lead}
              onChange={(event) => setLead(Number(event.target.value))}
            />
          </label>
          <label>
            {t('ui.a05d215daf2c3df2')}
            <input
              aria-label={t('ui.5dff10d16b825023')}
              className={input}
              type="number"
              min={1}
              max={3650}
              value={horizon}
              onChange={(event) => setHorizon(Number(event.target.value))}
            />
          </label>
          <button disabled={busy} className={button}>
            {t('ui.57ee14ce1425ca9b')}
          </button>
        </form>
      </div>
    </details>
  );
}
