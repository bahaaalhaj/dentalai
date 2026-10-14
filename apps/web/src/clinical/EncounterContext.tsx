import { t } from '../i18n';
import type { ClinicalWorkspace } from '@dentalai/contracts';
export function EncounterContext({
  workspace,
  patientId,
  encounterId,
  historical,
  open,
  selectEncounter,
  selectHistorical,
}: {
  workspace: ClinicalWorkspace;
  patientId: string;
  encounterId: string;
  historical: string;
  open: (action: { kind: 'start' | 'close'; id: string }) => void;
  selectEncounter: (id: string) => void;
  selectHistorical: (id: string) => void;
}) {
  return (
    <section className="ui-card ui-encounter-context space-y-3">
      <h2 className="text-xl font-bold">{t('ui.e12625129e52a1ab')}</h2>
      <button onClick={() => open({ kind: 'start', id: patientId })} className="text-indigo-600">
        {t('ui.ee4974f57be9edc0')}
      </button>
      {!workspace.encounters.length && <p>{t('ui.383e16f61ca805b6')}</p>}
      <label className="block">
        {t('ui.ffcce44b5ffe7fc7')}
        <select
          aria-label={t('ui.ffcce44b5ffe7fc7')}
          className="w-full p-3 border rounded-xl"
          value={encounterId}
          onChange={(e) => selectEncounter(e.target.value)}
        >
          <option value="">{t('ui.5d2de50a3f800d7d')}</option>
          {workspace.encounters
            .filter((e) => e.status === 'open')
            .map((e) => (
              <option key={e.id} value={e.id}>
                {new Date(e.startedAt).toLocaleString()} · {e.authorName}
              </option>
            ))}
        </select>
      </label>
      {encounterId && !historical && (
        <button onClick={() => open({ kind: 'close', id: encounterId })}>
          {t('ui.aa62874387c0a3b7')}
        </button>
      )}
      <label className="block">
        {t('ui.96ddcf26ee68ab76')}
        <select
          aria-label={t('ui.96ddcf26ee68ab76')}
          className="w-full p-3 border rounded-xl"
          value={historical}
          onChange={(e) => selectHistorical(e.target.value)}
        >
          <option value="">{t('ui.e577f7bee7c56721')}</option>
          {workspace.encounters
            .filter((e) => e.status !== 'open')
            .map((e) => (
              <option key={e.id} value={e.id}>
                {t('ui.616c9bf0809394db')}
                {new Date(e.endedAt ?? e.startedAt).toLocaleString()}
              </option>
            ))}
        </select>
      </label>
    </section>
  );
}
