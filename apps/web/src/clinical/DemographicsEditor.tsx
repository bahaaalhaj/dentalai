import type { ClinicalContent } from '@dentalai/contracts';
import { Field } from './ClinicalFields';
type Demographics = Extract<ClinicalContent, { kind: 'demographics' }>;
export function DemographicsEditor({
  value,
  change,
}: {
  value: Demographics;
  change: (value: Demographics) => void;
}) {
  return (
    <>
      {(['givenName', 'familyName', 'preferredName', 'dateOfBirth', 'phone', 'email'] as const).map(
        (key) => (
          <Field
            key={key}
            label={
              {
                givenName: 'Given name',
                familyName: 'Family name',
                preferredName: 'Preferred name',
                dateOfBirth: 'Date of birth',
                phone: 'Phone',
                email: 'Email',
              }[key]
            }
            type={key === 'dateOfBirth' ? 'date' : key === 'email' ? 'email' : 'text'}
            required={key === 'givenName' || key === 'familyName'}
            value={value[key] ?? ''}
            onChange={(v) => change({ ...value, [key]: v || null })}
          />
        ),
      )}
    </>
  );
}
