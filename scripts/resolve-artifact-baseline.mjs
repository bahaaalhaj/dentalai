import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function resolveArtifactBaseline(
  env = process.env,
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim(),
) {
  const supplied = env.ARTIFACT_PR_BASE_SHA || env.ARTIFACT_PUSH_BEFORE_SHA;
  let baseline;
  if (supplied && !/^0{40}$/.test(supplied)) {
    if (!/^[0-9a-f]{40}$/.test(supplied)) throw new Error('Invalid artifact baseline SHA.');
    baseline = git(['rev-parse', '--verify', `${supplied}^{commit}`]);
  } else {
    const branch = env.ARTIFACT_DEFAULT_BRANCH;
    if (!branch || branch.startsWith('-'))
      throw new Error('Repository default branch is required for a new-branch push.');
    const ref = `refs/remotes/origin/${branch}`;
    git(['check-ref-format', ref]);
    git(['rev-parse', '--verify', `${ref}^{commit}`]);
    baseline = git(['merge-base', 'HEAD', ref]);
  }
  if (!/^[0-9a-f]{40}$/.test(baseline) || /^0{40}$/.test(baseline))
    throw new Error('No real reviewed artifact baseline could be resolved.');
  git(['merge-base', '--is-ancestor', baseline, 'HEAD']);
  return baseline;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(`ARTIFACT_BASE_REF=${resolveArtifactBaseline()}`);
