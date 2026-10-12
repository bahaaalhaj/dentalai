import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const directory = process.argv[2];
if (!directory) throw new Error('Provide the CodeQL SARIF output directory.');
const files = (await readdir(directory)).filter((file) => file.endsWith('.sarif'));
if (!files.length) throw new Error('No SAST evidence produced; gate fails closed.');
let high = 0;
for (const file of files) {
  const document = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
  if (!Array.isArray(document.runs)) throw new Error('Invalid SAST evidence');
  for (const run of document.runs) {
    if (!Array.isArray(run.results)) throw new Error('Missing SAST results');
    const rules = run.tool?.driver?.rules ?? [];
    for (const result of run.results) {
      const rule =
        rules.find((candidate) => candidate.id === result.ruleId) ?? rules[result.ruleIndex];
      const severity = Number(
        rule?.properties?.['security-severity'] ?? result.properties?.['security-severity'] ?? 0,
      );
      if (severity >= 7 || result.level === 'error') high++;
    }
  }
}
console.log(`SAST gate: ${files.length} report(s), ${high} high/critical or error finding(s).`);
if (high) process.exitCode = 1;
