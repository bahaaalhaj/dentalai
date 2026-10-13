import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function unresolvedCard(card, fields) {
  return fields.filter(
    (key) =>
      typeof card?.[key] !== 'string' ||
      !card[key].trim() ||
      /UNKNOWN|RELEASE BLOCKER/i.test(card[key]),
  );
}
export const mandatoryCards = {
  'docs/dataset-card.json': [
    'source',
    'owner',
    'license',
    'permittedPurpose',
    'redistributionRights',
    'consent',
    'deidentification',
    'annotationProcess',
    'patientLevelSplit',
    'verification',
  ],
  'docs/model-card.json': [
    'architecture',
    'source',
    'owner',
    'license',
    'redistributionRights',
    'trainingProvenance',
    'evaluation',
    'clinicalApproval',
    'limitation',
  ],
};
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const purpose = process.argv[2];
  if (!['public', 'production'].includes(purpose))
    throw new Error(
      'Specify public or production release verification. Internal testing is not a release approval.',
    );
  const unresolved = [];
  for (const [file, fields] of Object.entries(mandatoryCards)) {
    const card = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of unresolvedCard(card, fields)) unresolved.push(`${file}:${key}`);
  }
  try {
    readFileSync('LICENSE', 'utf8');
  } catch {
    unresolved.push('repository license');
  }
  if (unresolved.length) throw new Error(`RELEASE BLOCKED: ${unresolved.join(', ')}`);
  console.log(
    'Mandatory recorded governance fields resolved. Independent review of evidence is still required.',
  );
}
