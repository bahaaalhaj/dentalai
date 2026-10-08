import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { MailSender } from './mail.js';

/** Private development mailbox. Actual messages are retained locally, never logged or served. */
export function localMailSender(directory: string): MailSender {
  if (
    !path.isAbsolute(directory) ||
    path.resolve(directory) === path.parse(path.resolve(directory)).root ||
    /\/(public|dist|node_modules)(\/|$)/.test(directory.replaceAll('\\', '/').toLowerCase())
  )
    throw new Error('Development mailbox must use an absolute private directory.');
  return async (message) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await realpath(directory)) !== path.resolve(directory))
      throw new Error('Development mailbox cannot be a symlink.');
    await writeFile(path.join(directory, `${randomUUID()}.json`), JSON.stringify(message), {
      flag: 'wx',
      mode: 0o600,
    });
  };
}
