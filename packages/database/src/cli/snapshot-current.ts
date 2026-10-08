import { generateDrizzleJson } from 'drizzle-kit/api';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import * as schema from '../schema/index.js';

// Generate ORM metadata after a reviewed custom SQL migration. SQL remains authoritative;
// triggers and other SQL-only invariants are intentionally not represented in ORM snapshots.
const directory = new URL('../../drizzle/meta/', import.meta.url);
const journal = JSON.parse(await readFile(new URL('_journal.json', directory), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};
const latest = journal.entries.at(-1);
if (!latest) throw new Error('No reviewed migrations exist.');
const name = `${String(latest.idx).padStart(4, '0')}_snapshot.json`;
const snapshots = (await readdir(directory))
  .filter((file) => file.endsWith('_snapshot.json'))
  .sort();
if (snapshots.includes(name))
  throw new Error('The current snapshot already exists; do not overwrite reviewed metadata.');
const previous = snapshots.at(-1);
if (!previous) throw new Error('A baseline snapshot is required.');
const metadata = JSON.parse(await readFile(new URL(previous, directory), 'utf8')) as { id: string };
const snapshot = generateDrizzleJson(schema, metadata.id);
await writeFile(new URL(name, directory), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `Generated ${name} for ${latest.tag}. Review the metadata before committing.\n`,
);
