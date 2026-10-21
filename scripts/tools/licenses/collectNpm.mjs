/** Collect npm lockfile package records without guessing dependency scope.
 *
 * @param lock - Parsed npm lockfile v3.
 * @returns {Array<object>} Package records with their lockfile flags.
 */
export function collectNpm(lock) {
  if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('Expected npm lockfile v3');
  }
  const records = [];
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = pkg.name || path.split('node_modules/').at(-1);
    const license = typeof pkg.license === 'string' ? pkg.license : 'UNKNOWN';
    records.push({
      ecosystem: 'npm',
      name,
      version: pkg.version || 'UNKNOWN',
      license,
      scope: pkg.dev === true ? 'dev' : 'shipped',
      path,
      missingLicense: !pkg.license,
      dev: pkg.dev === true,
      optional: pkg.optional === true,
      peer: pkg.peer === true,
      devOptional: pkg.devOptional === true,
    });
  }
  return records;
}
