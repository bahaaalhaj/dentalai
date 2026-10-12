import { t } from '../i18n';
import type { ClinicalContent } from '@dentalai/contracts';
import { SelectField } from './ClinicalFields';
type Note = Extract<ClinicalContent, { kind: 'note' }>;
export function NoteEditor({ value, change }: { value: Note; change: (value: Note) => void }) {
  return (
    <>
      <SelectField
        label={t('ui.1b906ea18db60730')}
        value={value.noteType}
        values={['progress', 'consultation', 'correction']}
        onChange={(v) => change({ ...value, noteType: v as Note['noteType'] })}
      />
      <label className="block">
        {t('ui.1bf411712bdbd316')}
        <textarea
          aria-label={t('ui.1bf411712bdbd316')}
          required
          className="mt-1 w-full p-3 border rounded-xl min-h-32"
          value={value.body}
          onChange={(e) => change({ ...value, body: e.target.value })}
        />
      </label>
    </>
  );
}
