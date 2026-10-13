// Existing tracked ML content is preserved. Reject future additions/updates, not approved removals.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import process from 'node:process';
import path from 'node:path';
const base = process.env.ARTIFACT_BASE_REF || 'HEAD';
if (base !== 'HEAD' && !/^[0-9a-f]{40}$/.test(base))
  throw new Error('Artifact base must be a commit SHA');
if (/^0{40}$/.test(base))
  throw new Error('An explicit reviewed baseline commit is required for an initial push');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', '-z', base], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const files = [...new Set([...changed, ...untracked])];
const blocked = files.filter(
  (file) =>
    /(^|\/)(datasets?|dataset_yolo|converted_datasets?|training_data|checkpoints|runs|dental_training|wandb|\.venv|__pycache__|\.pytest_cache)\//.test(
      file,
    ) ||
    /^scripts\/dataset\//.test(file) ||
    /\.(pt|pth|ckpt|onnx|weights|tflite|h5)$/i.test(file) ||
    statSync(path.join(root, file)).size > 5 * 1024 * 1024,
);
if (blocked.length)
  throw new Error(
    `Training data, caches, models or oversized files require private artifact migration, not application Git: ${blocked.join(', ')}`,
  );
process.stdout.write(
  `Artifact gate passed for ${files.length} changed tracked files. Existing ML history remains preserved.\n`,
);
