import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installedPlatforms } from './installedPlatforms.mjs';

const USAGE = 'Usage: verifyPublished.mjs --version <x.y.z> --fixture <file> [--attempts 12]';

/** Resolves after a pause. */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Parses the command line.
 *
 * @param args - Arguments after the script name.
 * @returns {{version: string, fixture: string, attempts: number}} The options.
 */
function parseArguments(args) {
  const keys = { '--version': 'version', '--fixture': 'fixture', '--attempts': 'attempts' };
  const values = { attempts: '12' };
  for (let index = 0; index < args.length; index += 2) {
    if (!keys[args[index]] || index + 1 >= args.length) throw new Error(USAGE);
    values[keys[args[index]]] = args[index + 1];
  }
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(values.version ?? '') || !values.fixture) throw new Error(USAGE);
  return { ...values, attempts: Number(values.attempts) };
}

/** Runs npm in a directory, with the output streamed to the log.
 *
 * @param args - npm arguments.
 * @param cwd - Working directory.
 * @returns {string} Captured standard output.
 */
const npm = (args, cwd) => execFileSync('npm', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32',
});

/** Installs the published packages into a clean project and uses them as a consumer would:
 * the launcher runs the right platform's binary on a fixture, and the library loads from both
 * module systems.
 *
 * A new version takes a moment to appear on every registry mirror, so the install is retried.
 *
 * @param args - `--version`, `--fixture`, and optionally `--attempts` (installs tried, 30 s apart).
 * @returns {Promise<void>}
 * @throws When an install keeps failing or a published package does not work.
 */
export async function verifyPublished(args = process.argv.slice(2)) {
  const { version, fixture, attempts } = parseArguments(args);
  const work = mkdtempSync(path.join(tmpdir(), 'carburetor-published-'));
  try {
    writeFileSync(path.join(work, 'package.json'), '{"name":"consumer","private":true}\n');
    for (let attempt = 1; ; attempt += 1) {
      try {
        npm(['install', '--no-audit', '--no-fund', `@react-carburetor/lint@${version}`,
          `@react-carburetor/core@${version}`, 'react@19', 'react-dom@19'], work);
        break;
      } catch (error) {
        if (attempt >= attempts) throw error;
        console.log(`install attempt ${attempt} failed; waiting for the registry`);
        await sleep(30_000);
      }
    }

    const installed = installedPlatforms(path.join(work, 'node_modules'));
    if (installed.length !== 1) {
      throw new Error(`Expected exactly one platform package, found: ${installed.join(', ') || 'none'}`);
    }
    console.log(`platform package: ${installed[0]}`);

    const launcher = path.join(work, 'node_modules', '@react-carburetor', 'lint', 'bin', 'carburetor-lint.js');
    const env = { ...process.env };
    delete env.CARBURETOR_LINT_BIN;
    /** Runs the installed launcher with the given arguments. */
    const run = commandArgs => spawnSync(process.execPath, [launcher, ...commandArgs],
      { cwd: work, env, encoding: 'utf8' });
    const help = run(['--help']);
    if (help.status !== 0) throw new Error(`--help exited ${help.status}: ${help.stderr}${help.stdout}`);
    const lint = run(['--format=json', '--rule', 'no-get-data-in-render=error', path.resolve(fixture)]);
    if (lint.status !== 1 || !lint.stdout.includes('no-get-data-in-render')) {
      throw new Error(`The fixture lint exited ${lint.status}: ${lint.stderr}${lint.stdout}`);
    }

    const probe = 'const c = require("@react-carburetor/core"); if (typeof c.Carburetor !== "function") process.exit(3);';
    const esm = 'import("@react-carburetor/core").then(m => { if (typeof m.Carburetor !== "function") process.exit(4); });';
    for (const [label, code] of [['require', probe], ['import', esm]]) {
      const result = spawnSync(process.execPath, ['-e', code], { cwd: work, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`@react-carburetor/core ${label} failed (${result.status}): ${result.stderr}`);
    }
    console.log(`verified: @react-carburetor/lint@${version} and @react-carburetor/core@${version} ` +
      `work on ${process.platform}-${process.arch}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyPublished().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
