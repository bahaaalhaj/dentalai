import { t } from '../i18n';
import { getErrorMessage } from '../lib/errors';
import { useState } from 'react';
import {
  ClinicalWriteSchema,
  type ClinicalContent,
  type ClinicalRecord,
  type ClinicalWorkspace,
  type ClinicalWrite,
} from '@dentalai/contracts';
import { NoteEditor } from './NoteEditor';
import { RiskEditor } from './RiskEditor';
import { OdontogramEditor } from './Odontogram';
import { DemographicsEditor } from './DemographicsEditor';
import { TreatmentPlanEditor } from './TreatmentPlanEditor';
import { Field, SelectField } from './ClinicalFields';

const defaults: Record<ClinicalContent['kind'], ClinicalContent> = {
  demographics: {
    kind: 'demographics',
    givenName: '',
    familyName: '',
    preferredName: null,
    dateOfBirth: null,
    phone: null,
    email: null,
  },
  note: { kind: 'note', noteType: 'progress', body: '' },
  alert: { kind: 'alert', title: '', details: null, severity: 'warning', active: true },
  allergy: { kind: 'allergy', substance: '', reaction: null, severity: null, status: 'active' },
  medication: {
    kind: 'medication',
    medicationName: '',
    dose: null,
    route: null,
    frequency: null,
    status: 'active',
  },
  finding: {
    kind: 'finding',
    toothCode: '',
    surfaces: [],
    findingCode: 'caries',
    status: 'active',
    details: null,
  },
  procedure: {
    kind: 'procedure',
    toothCode: '',
    surfaces: [],
    procedureCode: 'restoration',
    description: '',
    status: 'planned',
  },
  plan: { kind: 'plan', name: '', status: 'draft', items: [] },
};
export function ClinicalRecordEditor({
  workspace,
  encounterId,
  correction,
  tooth,
  onSave,
  cancel,
}: {
  workspace: ClinicalWorkspace;
  encounterId: string;
  correction: ClinicalRecord | null;
  tooth: string | undefined;
  onSave: (body: ClinicalWrite) => Promise<void>;
  cancel: () => void;
}) {
  const [data, setData] = useState<ClinicalContent>(
    correction?.data ??
      (tooth ? ({ ...defaults.finding, toothCode: tooth } as ClinicalContent) : defaults.note),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionChosen, setActionChosen] = useState(!!correction);
  return (
    <form
      aria-label={t('ui.a7656eae828d7c83')}
      className="bg-white p-6 rounded-2xl border space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        if ((data.kind === 'finding' || data.kind === 'procedure') && !actionChosen) {
          setError(t('ui.cbc3e0be89a93efb'));
          return;
        }
        const parsed = ClinicalWriteSchema.safeParse({
          encounterId,
          supersedesId: correction?.id ?? null,
          reason,
          data,
        });
        if (!parsed.success) {
          setError(t('error.invalid'));
          return;
        }
        setBusy(true);
        try {
          await onSave(parsed.data);
        } catch (err) {
          setError(getErrorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-xl font-bold">
        {correction
          ? t('ui.ae7103f888d2af50', { v0: correction.version })
          : t('ui.2d9747d4d204a3b4')}
      </h2>
      {!correction && (
        <SelectField
          label={t('ui.e8aa77fb5256605c')}
          value={data.kind}
          values={Object.keys(defaults)}
          onChange={(kind) => {
            setActionChosen(false);
            const next = defaults[kind as ClinicalContent['kind']];
            setData(
              next.kind === 'demographics'
                ? {
                    ...next,
                    givenName: workspace.patient.givenName,
                    familyName: workspace.patient.familyName,
                  }
                : next,
            );
          }}
        />
      )}
      {data.kind === 'note' ? (
        <NoteEditor value={data} change={setData} />
      ) : data.kind === 'demographics' ? (
        <DemographicsEditor value={data} change={setData} />
      ) : data.kind === 'finding' || data.kind === 'procedure' ? (
        <OdontogramEditor
          value={data}
          change={setData}
          actionChosen={actionChosen}
          chooseAction={() => setActionChosen(true)}
        />
      ) : data.kind === 'plan' ? (
        <TreatmentPlanEditor value={data} change={setData} services={workspace.services} />
      ) : (
        <RiskEditor value={data} change={setData} />
      )}
      <Field label={t('ui.57608d19816aef63')} required value={reason} onChange={setReason} />
      {error && (
        <p role="alert" className="text-red-700">
          {error} {t('ui.a94280aaaf8b3b73')}
        </p>
      )}
      <div className="flex gap-4">
        <button
          className="bg-indigo-600 text-white p-3 rounded-xl disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? t('ui.23e39291d6135814') : t('ui.3de100106dd4e52e')}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          {t('ui.a11cb4e4ce6b8a8c')}
        </button>
      </div>
      <p className="text-sm text-slate-500">{t('ui.9090a6ef071c6f4f')}</p>
    </form>
  );
}
