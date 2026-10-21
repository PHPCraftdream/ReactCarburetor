import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = 'Usage: verifyGating.mjs --launcher <tgz> --packages <dir of platform tgz files> ' +
  '--expect <package name> [--skip-run]';

/** Parses the command line.
 *
 * @param args - Arguments after the script name.
 * @returns {{launcher: string, packages: string, expect: string, skipRun: boolean}} The options.
 */
function parseArguments(args) {
  const keys = { '--launcher': 'launcher', '--packages': 'packages', '--expect': 'expect' };
  const values = { skipRun: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--skip-run') values.skipRun = true;
    else if (keys[args[index]] && index + 1 < args.length) values[keys[args[index]]] = args[++index];
    else throw new Error(USAGE);
  }
  if (!values.launcher || !values.packages || !values.expect) throw new Error(USAGE);
  return values;
}

/** Turns a path into the `file:` specifier npm accepts on every platform.
 *
 * @param file - A local file.
 * @returns {string} The specifier.
 */
const fileSpec = file => `file:${path.resolve(file).split(path.sep).join('/')}`;

/** Proves that an install keeps only the binary of the machine it runs on.
 *
 * Every platform package is offered to the install as an optional dependency of a fresh project,
 * next to the launcher, exactly as the registry would offer them. npm must skip the ones whose
 * `os`, `cpu` or `libc` fields do not match this machine and install the one that does; the
 * launcher must then start that binary.
 *
 * @param args - `--launcher` (the packed launcher), `--packages` (a directory of the packed
 * platform packages), `--expect` (the one package this machine must end up with), and
 * `--skip-run` to check only which packages were installed.
 * @returns {void}
 * @throws When the installed set differs from the expected one or the launcher cannot run it.
 */
export function verifyGating(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const tarballs = readdirSync(options.packages).filter(name => name.endsWith('.tgz'));
  const names = tarballs.map(name => name.replace(/-\d+\.\d+\.\d+.*\.tgz$/, ''));
  if (!names.includes(options.expect)) {
    throw new Error(`${options.expect} is not among the offered packages: ${names.join(', ') || 'none'}`);
  }
  const work = mkdtempSync(path.join(tmpdir(), 'carburetor-gating-'));
  try {
    const optionalDependencies = Object.fromEntries(tarballs.map((name, index) =>
      [names[index], fileSpec(path.join(options.packages, name))]));
    writeFileSync(path.join(work, 'package.json'), JSON.stringify({
      name: 'consumer',
      private: true,
      dependencies: { 'carburetor-lint': fileSpec(options.launcher) },
      optionalDependencies,
    }));
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'],
      { cwd: work, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });

    const modules = path.join(work, 'node_modules');
    const installed = readdirSync(modules).filter(name => name.startsWith('carburetor-lint-')).sort();
    console.log(`offered: ${names.length} platform packages; installed: ${installed.join(', ') || 'none'}`);
    if (installed.length !== 1 || installed[0] !== options.expect) {
      throw new Error(`Expected only ${options.expect} to be installed, got: ${installed.join(', ') || 'none'}`);
    }
    if (options.skipRun) return;

    const launcher = path.join(modules, 'carburetor-lint', 'bin', 'carburetor-lint.js');
    if (!existsSync(launcher)) throw new Error('The launcher was not installed');
    const env = { ...process.env };
    delete env.CARBURETOR_LINT_BIN;
    const help = spawnSync(process.execPath, [launcher, '--help'], { cwd: work, env, encoding: 'utf8' });
    if (help.status !== 0) {
      throw new Error(`The launcher could not run ${options.expect}: ${help.stderr}${help.stdout}`);
    }
    console.log(`gating: only ${options.expect} was installed, and it runs`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    verifyGating();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
