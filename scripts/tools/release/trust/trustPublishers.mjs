import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { trustPlan } from './trustPlan.mjs';

const USAGE = 'Usage: trustPublishers.mjs [--print | --list | --dry-run]';

/** Builds the npm invocations for a mode.
 *
 * @param mode - `apply`, `dry-run`, `list` or `print`.
 * @param plan - Result of `trustPlan`.
 * @returns {string[][]} One npm argument list per package.
 */
function commands(mode, plan) {
  return plan.packages.map(name => mode === 'list'
    ? ['trust', 'list', name]
    : ['trust', 'github', name, '--repo', plan.repository, '--file', plan.workflow,
      '--env', plan.environment, '--yes', ...(mode === 'dry-run' ? ['--dry-run'] : [])]);
}

/** Sets up (or lists) the GitHub Actions trusted publisher of every release package.
 *
 * The packages must already exist on the registry and the npm session must be logged in with
 * an account that can publish them. Packages are processed in turn; a failure is reported at the
 * end and does not stop the rest.
 *
 * @param args - One of `--print` (show the commands only), `--list`, `--dry-run`; none applies.
 * @returns {void}
 * @throws When the arguments are unknown or a package could not be configured.
 */
export function trustPublishers(args = process.argv.slice(2)) {
  const modes = { '--print': 'print', '--list': 'list', '--dry-run': 'dry-run' };
  if (args.length > 1 || (args.length === 1 && !modes[args[0]])) throw new Error(USAGE);
  const mode = modes[args[0]] ?? 'apply';
  const failed = [];
  for (const npmArgs of commands(mode, trustPlan())) {
    if (mode === 'print') {
      console.log(['npm', ...npmArgs].join(' '));
      continue;
    }
    console.log(`== npm ${npmArgs.join(' ')}`);
    const result = spawnSync('npm', npmArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) failed.push(npmArgs[2]);
  }
  if (failed.length) throw new Error(`trusted publisher failed for: ${failed.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    trustPublishers();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
