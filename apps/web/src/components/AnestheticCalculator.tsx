import { ANESTHESIA_RULE_SET } from '@dentalai/domain';
import { CLINICAL_FEATURE_UNAVAILABLE_MESSAGE } from '../lib/feature-flags';

export function AnestheticCalculator({ patientId }: { patientId: string }) {
  // Legacy component name retained for existing callers. No browser calculation or Supabase path.
  // Neither a demo flag nor clinician confirmation can bypass the missing-reference gate.
  return (
    <section
      key={patientId}
      className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 space-y-4"
    >
      <h3 className="text-xl font-black text-slate-900">
        Experimental Anesthetic Decision Support
      </h3>
      <div
        role="status"
        className="p-5 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900"
      >
        {CLINICAL_FEATURE_UNAVAILABLE_MESSAGE}
        <p>
          No approved clinical references or formulary are available. Recommendations and clinician
          confirmation are disabled, including in development/demo environments.
        </p>
      </div>
      <p>
        This is decision support, not a prescription. The dentist remains responsible for the final
        decision. No dose or contraindication assessment has been calculated.
      </p>
      <p className="text-sm text-slate-500">
        Rule set: {ANESTHESIA_RULE_SET.version}. Formulary: {ANESTHESIA_RULE_SET.formularyVersion}.
        Clinical approval: pending.
      </p>
    </section>
  );
}
