import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthIdentity, BillingCatalog } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { t } from '../i18n';
import { PageState } from '../ui/PageState';
export function PatientsDirectory({ identity }: { identity: AuthIdentity }) {
  const [items, setItems] = useState<BillingCatalog['patients']>([]),
    [query, setQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const dentist = identity.activeMembership?.roles.includes('dentist') ?? false;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const load = dentist
      ? apiClient.clinicalPatients()
      : apiClient.billingCatalog().then((value) => value.patients);
    void load
      .then((value) => {
        if (active) setItems(value);
      })
      .catch((e: unknown) => {
        if (active) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dentist, revision]);
  const filtered = items.filter((patient) =>
    `${patient.givenName} ${patient.familyName} ${patient.medicalRecordNumber}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <main className="space-y-5">
      <header className="ui-page-header">
        <div>
          <h1>{t('polish.patients')}</h1>
          <p>{t('polish.patientScope')}</p>
        </div>
      </header>
      <label className="block ui-card">
        {t('polish.searchPatients')}
        <input
          className="w-full mt-2"
          type="search"
          placeholder={t('polish.searchHint')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {loading ? (
        <PageState title={t('polish.loading')} loading />
      ) : error ? (
        <PageState title={error} error retry={() => setRevision((value) => value + 1)} />
      ) : !filtered.length ? (
        <PageState title={t('polish.noPatients')} description={t('polish.noPatientsHint')} />
      ) : (
        <section className="ui-card ui-table-scroll">
          <table className="ui-table">
            <caption className="sr-only">{t('polish.accessiblePatients')}</caption>
            <thead>
              <tr>
                <th>{t('ui.835043ec8e6b7921')}</th>
                <th>{t('polish.recordNumber')}</th>
                <th>{t('polish.quickActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((patient) => (
                <tr key={patient.id}>
                  <td>
                    <bdi>
                      {patient.givenName} {patient.familyName}
                    </bdi>
                  </td>
                  <td>
                    <bdi>{patient.medicalRecordNumber}</bdi>
                  </td>
                  <td>
                    {dentist ? (
                      <Link
                        className="ui-btn-secondary"
                        to={`/clinical/patients?patient=${patient.id}`}
                      >
                        {t('polish.openClinical')}
                      </Link>
                    ) : (
                      <Link className="ui-btn-secondary" to="/appointments">
                        {t('ui.a1164b91bb0b2fad')}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
