// Pilot restore reconciliation; does not print object keys, clinical data or credentials.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDatabase } from '@dentalai/database';
import { FilesystemPrivateStorage } from '../apps/api/dist/domains/imaging/filesystem-storage.js';
const url = (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim();
const root = process.env.PRIVATE_STORAGE_DIRECTORY;
if (!root) throw new Error('Explicit private filesystem storage required.');
const storage = new FilesystemPrivateStorage(root);
const { pool } = createDatabase(url);
try {
  let verified = 0;
  const rows = await pool.query(
    "SELECT object_key,sha256,size_bytes::text FROM files WHERE status='available' ORDER BY id",
  );
  for (const row of rows.rows) {
    const bytes = await storage.get(row.object_key);
    if (
      String(bytes.length) !== row.size_bytes ||
      createHash('sha256').update(bytes).digest('hex') !== row.sha256
    )
      throw new Error(
        'Private file checksum/size reconciliation failed. Keep the destination isolated.',
      );
    verified++;
  }
  const hashes = [];
  async function walk(directory, relative = '') {
    for (const entry of await readdir(directory)) {
      const full = `${directory}/${entry}`;
      const key = `${relative}${entry}`;
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error('Private tree contains a symlink');
      if (info.isDirectory()) await walk(full, `${key}/`);
      else if (info.isFile())
        hashes.push([
          key,
          createHash('sha256')
            .update(await readFile(full))
            .digest('hex'),
        ]);
      else throw new Error('Private tree contains an unsupported file');
    }
  }
  await walk(root);
  hashes.sort(([a], [b]) => a.localeCompare(b));
  console.log(
    JSON.stringify({
      availableFilesVerified: verified,
      objects: hashes.length,
      objectTreeSha256: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    }),
  );
} finally {
  await pool.end();
}
