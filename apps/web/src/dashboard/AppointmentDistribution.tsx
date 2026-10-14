import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { Appointment } from '@dentalai/contracts';
import { displayStatus } from '../i18n/display';
import { t } from '../i18n';
export function AppointmentDistribution({ items }: { items: Appointment[] }) {
  const statuses = [...new Set(items.map((item) => item.status))];
  const data = statuses.map((status) => ({
    name: displayStatus(status),
    count: items.filter((item) => item.status === status).length,
  }));
  return (
    <section className="ui-card">
      <h2>{t('polish.distribution')}</h2>
      <p className="ui-caption mt-2">{t('polish.distributionHint')}</p>
      {!data.length ? (
        <p className="ui-caption py-8">{t('polish.noChart')}</p>
      ) : (
        <>
          <div className="ui-chart-container" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                accessibilityLayer={false}
                data={data}
                margin={{ top: 25, left: 0, bottom: 0, right: 15 }}
              >
                <CartesianGrid vertical={false} stroke="#eef1f6" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip />
                <Bar
                  dataKey="count"
                  name={t('polish.quantity')}
                  fill="#6752e8"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="ui-chart-table" aria-label={t('polish.distribution')}>
            {data.map((row) => (
              <li key={row.name}>
                {row.name}: <b>{row.count}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
