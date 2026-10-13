import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { PrivateStorage } from './storage.js';
import { withStorageDeadline } from './storage-deadline.js';

/** Explicit local/private adapter, never a fallback. Its directory is not mounted by Express. */
export class FilesystemPrivateStorage implements PrivateStorage {
  readonly provider = 'filesystem-private';
  readonly bucket = 'private-local-clinical';
  private readonly directory: string;
  async health(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (
      (await lstat(this.directory)).isSymbolicLink() ||
      (await realpath(this.directory)) !== this.directory
    )
      throw new Error('Private storage root is not canonical');
    await access(this.directory, constants.R_OK | constants.W_OK);
  }
  constructor(directory: string) {
    if (!path.isAbsolute(directory))
      throw new Error('Private storage requires an absolute directory.');
    this.directory = path.resolve(directory);
    const normalized = this.directory.replaceAll('\\', '/').toLowerCase();
    if (
      /\/(public|dist|node_modules)(\/|$)/.test(normalized) ||
      this.directory === path.parse(this.directory).root
    )
      throw new Error('Private storage cannot use a public, build or filesystem root directory.');
  }
  private async target(key: string) {
    if (!/^clinical\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/.test(key))
      throw new Error('Invalid private object key.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (
      (await lstat(this.directory)).isSymbolicLink() ||
      (await realpath(this.directory)) !== this.directory
    )
      throw new Error('Private storage root must not be a symlink.');
    const namespace = path.join(this.directory, key.split('/')[0]!, key.split('/')[1]!);
    const base = path.dirname(namespace);
    await mkdir(base, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    if ((await realpath(base)) !== base || (await lstat(base)).isSymbolicLink())
      throw new Error('Private object path is not canonical.');
    await mkdir(namespace, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    if ((await realpath(base)) !== base || (await realpath(namespace)) !== namespace)
      throw new Error('Private object path is not canonical.');
    return path.join(namespace, path.basename(key));
  }
  async put(key: string, data: Buffer, contentType: string, caller?: AbortSignal) {
    return withStorageDeadline(
      15000,
      (signal) => this.write(key, data, contentType, signal),
      caller,
    );
  }
  private async write(key: string, data: Buffer, contentType: string, signal: AbortSignal) {
    if (contentType !== 'image/png' || !data.length || data.length > 10 * 1024 * 1024)
      throw new Error('Invalid canonical image.');
    const target = await this.target(key);
    signal.throwIfAborted();
    try {
      await writeFile(target, data, { flag: 'wx', mode: 0o600, signal });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = await this.get(key, signal);
      const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
      if (hash(previous) !== hash(data))
        throw new Error('Immutable private object already exists.', { cause: error });
    }
  }
  async get(key: string, caller?: AbortSignal) {
    return withStorageDeadline(15000, (signal) => this.read(key, signal), caller);
  }
  private async read(key: string, signal: AbortSignal) {
    const target = await this.target(key);
    signal.throwIfAborted();
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 10 * 1024 * 1024)
      throw new Error('Invalid private object.');
    return readFile(target, { signal });
  }
}
