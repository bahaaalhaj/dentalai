import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, open, stat, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('DAIBAK01');
export async function readBackupKey(file) {
  if (!file || !path.isAbsolute(file)) throw new Error('Use an absolute private backup key file.');
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 66 ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  )
    throw new Error('Backup key requires a private regular file with owner-only access.');
  const value = (await readFile(file, 'utf8')).trim();
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new Error('Backup key must be a privately stored 32-byte hex key.');
  return Buffer.from(value, 'hex');
}
export async function encryptStream(source, destination, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(magic);
  const header = await open(destination, 'wx', 0o600);
  await header.write(Buffer.concat([magic, iv]));
  await header.close();
  try {
    await pipeline(source, cipher, createWriteStream(destination, { flags: 'a' }));
    const tail = await open(destination, 'a');
    await tail.write(cipher.getAuthTag());
    await tail.close();
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
}
/** Authenticate fully BEFORE using plaintext for restore. No unauthenticated pipe to pg_restore. */
export async function decryptFile(source, destination, key) {
  const info = await stat(source);
  if (info.size < 36) throw new Error('Invalid backup envelope');
  const handle = await open(source, 'r');
  const header = Buffer.alloc(20);
  const tag = Buffer.alloc(16);
  await handle.read(header, 0, 20, 0);
  await handle.read(tag, 0, 16, info.size - 16);
  await handle.close();
  if (!header.subarray(0, 8).equals(magic)) throw new Error('Invalid backup envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
  decipher.setAAD(magic);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(source, { start: 20, end: info.size - 17 }),
      decipher,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    await unlink(destination).catch(() => {});
    throw new Error('Backup authentication failed; restore refused.');
  }
}
