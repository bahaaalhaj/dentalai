import { t } from '../i18n';
import { ANESTHESIA_RULE_SET } from '@dentalai/domain';
import { CLINICAL_FEATURE_UNAVAILABLE_MESSAGE } from '../lib/feature-flags';

export function AnestheticCalculator({ patientId }: { patientId: string }) {
  // Legacy component name retained for existing callers. No browser calculation or database path.
  // Neither a demo flag nor clinician confirmation can bypass the missing-reference gate.
  return (
    <section key={patientId} className="ui-safety-notice block space-y-2">
      <h3 className="font-semibold">{t('ui.4f68ceb6677d7c34')}</h3>
      <div role="status" className="text-sm">
        {CLINICAL_FEATURE_UNAVAILABLE_MESSAGE}
        <p>{t('ui.e6c0e584995730b3')}</p>
      </div>
      <p>{t('ui.e1d61cc5a38cf797')}</p>
      <details>
        <summary>{t('polish.safetyDetails')}</summary>
        <p className="text-sm text-slate-500">
          {t('ui.564f511cc6e83af6')}
          {ANESTHESIA_RULE_SET.version}
          {t('ui.ad0e031390722825')}
          {ANESTHESIA_RULE_SET.formularyVersion}
          {t('ui.0bd6808146a5be64')}
        </p>
      </details>
    </section>
  );
}
