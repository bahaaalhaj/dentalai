import type { ClinicalContent } from '@dentalai/contracts';
import { SelectField } from './ClinicalFields';
type Note = Extract<ClinicalContent, { kind: 'note' }>;
export function NoteEditor({ value, change }: { value: Note; change: (value: Note) => void }) {
  return (
    <>
      <SelectField
        label="Note type"
        value={value.noteType}
        values={['progress', 'consultation', 'correction']}
        onChange={(v) => change({ ...value, noteType: v as Note['noteType'] })}
      />
      <label className="block">
        Clinical note
        <textarea
          aria-label="Clinical note"
          required
          className="mt-1 w-full p-3 border rounded-xl min-h-32"
          value={value.body}
          onChange={(e) => change({ ...value, body: e.target.value })}
        />
      </label>
    </>
  );
}
