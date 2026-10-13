import assert from 'node:assert/strict';
import { generatedEnglish } from '../apps/web/src/i18n/generated.ts';
import { english, arabic } from '../apps/web/src/i18n/messages.ts';
import { interfaceArabic } from '../apps/web/src/i18n/interface-arabic.ts';
// Brands, technical identifiers and self-named language choices are deliberate exceptions.
const exceptions = new Set([
  'DentalAi',
  'English',
  'العربية',
  'UTC',
  'SHA-256: ',
  'Artifact SHA-256: ',
  '9XX XXX XXX',
  'name@example.com',
]);
const missing = Object.values(generatedEnglish).filter(
  (value) => !interfaceArabic[value] && !exceptions.has(value),
);
for (const key of Object.keys(english))
  assert.ok(arabic[key], `Missing Arabic explicit key: ${key}`);
for (const [source, translated] of Object.entries(interfaceArabic)) {
  const placeholders = (s) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    placeholders(translated),
    placeholders(source),
    `Interpolation mismatch: ${source}`,
  );
}
assert.deepEqual(missing, [], `Missing Arabic interface messages: ${JSON.stringify(missing)}`);
console.log(
  `Arabic catalog gate passed for ${Object.keys(generatedEnglish).length} extracted + ${Object.keys(english).length} explicit keys; ${exceptions.size} documented technical/brand exceptions. Stored clinical terminology is not automatically translated.`,
);
