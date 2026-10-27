import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Workflow file and environment a trusted publisher must name; see docs/releasing.md. */
const WORKFLOW = 'release.yml';
const ENVIRONMENT = 'npm';

/** Reads the trusted-publisher settings every package of the release needs.
 *
 * The package list comes from the launcher's `optionalDependencies`, as the release workflow
 * does, so a new platform needs no change here.
 *
 * @param root - Repository root.
 * @returns {{repository: string, workflow: string, environment: string, packages: string[]}} The plan.
 * @throws When the root manifest does not point at a GitHub repository.
 */
export function trustPlan(root = process.cwd()) {
  const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const library = read('package.json');
  const launcher = read('npm/carburetor-lint/package.json');
  const url = typeof library.repository === 'string' ? library.repository : library.repository?.url ?? '';
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`package.json repository is not a GitHub URL: ${url || 'missing'}`);
  return {
    repository: match[1],
    workflow: WORKFLOW,
    environment: ENVIRONMENT,
    packages: [...Object.keys(launcher.optionalDependencies), launcher.name, library.name],
  };
}
