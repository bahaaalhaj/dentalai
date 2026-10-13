export function releaseTag(environment = process.env) {
  const tag = environment.RELEASE_TAG ?? 'local-verification';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(tag))
    throw new Error('RELEASE_TAG must be a valid immutable candidate tag.');
  return tag;
}
