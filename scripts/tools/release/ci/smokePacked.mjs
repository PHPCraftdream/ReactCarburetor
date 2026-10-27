import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractTarball } from './extractTarball.mjs';

const USAGE = 'Usage: smokePacked.mjs --launcher <dir> --package <dir> --fixture <file>';

/** Parses the command line.
 *
 * @param args - Arguments after the script name.
 * @returns {{launcher: string, packageDir: string, fixture: string}} The three operands.
 */
function parseArguments(args) {
  const keys = { '--launcher': 'launcher', '--package': 'packageDir', '--fixture': 'fixture' };
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!keys[args[index]] || index + 1 >= args.length) throw new Error(USAGE);
    values[keys[args[index]]] = args[index + 1];
  }
  if (Object.keys(keys).length !== Object.keys(values).length) throw new Error(USAGE);
  return values;
}

/** Installs the launcher and one platform package from their tarballs into a scratch
 * `node_modules`, then runs the launcher as a consumer would.
 *
 * This is what `npm install` does after it has chosen the platform package, minus the registry:
 * it proves the tarball holds the binary with its execute bit, that the launcher finds it by
 * name next to itself, and that the binary runs and lints a fixture.
 *
 * @param args - `--launcher <dir>` (the launcher package), `--package <dir>` (a platform package
 * directory holding its packed `.tgz`), `--fixture <file>` (a file with a known violation).
 * @returns {Promise<void>}
 * @throws When the launcher fails to start the binary or the lint result is not the expected one.
 */
export async function smokePacked(args = process.argv.slice(2)) {
  const { launcher, packageDir, fixture } = parseArguments(args);
  const platformName = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')).name;
  const platformTarball = readdirSync(packageDir).find(name => name.endsWith('.tgz'));
  if (!platformTarball) throw new Error(`No packed tarball in ${packageDir}`);
  const work = mkdtempSync(path.join(tmpdir(), 'carburetor-smoke-'));
  try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', work],
      { cwd: launcher, encoding: 'utf8', shell: process.platform === 'win32' }));
    const modules = path.join(work, 'node_modules');
    await extractTarball(path.join(work, packed[0].filename), path.join(modules, '@react-carburetor', 'lint'));
    await extractTarball(path.join(packageDir, platformTarball), path.join(modules, platformName));

    const bin = path.join(modules, '@react-carburetor', 'lint', 'bin', 'carburetor-lint.js');
    const env = { ...process.env };
    delete env.CARBURETOR_LINT_BIN;
    /** Runs the unpacked launcher with the given arguments. */
    const run = commandArgs => spawnSync(process.execPath, [bin, ...commandArgs],
      { cwd: work, env, encoding: 'utf8' });

    const help = run(['--help']);
    if (help.status !== 0) {
      throw new Error(`--help exited ${help.status}: ${help.stderr}${help.stdout}`);
    }
    const lint = run(['--format=json', '--rule', 'no-get-data-in-render=error', path.resolve(fixture)]);
    if (lint.status !== 1 || !lint.stdout.includes('no-get-data-in-render')) {
      throw new Error(`The fixture lint exited ${lint.status} instead of reporting its violation: ` +
        `${lint.stderr}${lint.stdout}`);
    }
    console.log(`smoke: ${platformName} installs and runs from its tarball`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  smokePacked().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
