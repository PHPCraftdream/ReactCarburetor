import { afterEach, describe, expect, it } from '@rstest/core';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fingerprint } from '../../../scripts/tools/licenses/fingerprint.mjs';

const root = process.cwd();
const fixtures: string[] = [];
const trackedFiles = [
  'package.json', 'package-lock.json', 'native/Cargo.lock', 'native/Cargo.toml',
  'scripts/tools/licenses/parseLicense.mjs', 'scripts/tools/licenses/collectNpm.mjs',
  'scripts/tools/licenses/collectRust.mjs', 'scripts/tools/licenses/evaluate.mjs',
  'scripts/tools/licenses/fingerprint.mjs', 'scripts/tools/licenses/check.mjs',
  'scripts/tools/licenses/policy.json',
];

/** Creates a self-contained fixture using copies of the current repository inputs.
 *
 * @returns {Promise<string>} Temporary fixture root.
 */
async function createFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(root, '__tests__/Tooling/licenses/fingerprint-'));
  fixtures.push(dir);
  for (const file of trackedFiles) {
    const destination = path.join(dir, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(root, file)));
  }
  return dir;
}

/** Writes JSON to a fixture path.
 *
 * @param {string} dir - Fixture root.
 * @param {string} file - Relative JSON path.
 * @param {unknown} value - JSON value.
 */
async function writeJson(dir: string, file: string, value: unknown): Promise<void> {
  await writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('license fingerprint', () => {
  it('ignores incidental top-level and root package metadata changes', async () => {
    const dir = await createFixture();
    const original = await fingerprint(dir);
    const lockPath = path.join(dir, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.version = '99.0.0';
    lock.name = 'renamed';
    Object.assign(lock.packages[''], { version: '99.0.0', name: 'renamed', scripts: { build: 'changed' } });
    await writeJson(dir, 'package-lock.json', lock);
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    pkg.version = '99.0.0';
    pkg.scripts = { build: 'changed' };
    await writeJson(dir, 'package.json', pkg);
    expect(await fingerprint(dir)).toBe(original);
  });

  it('canonicalizes nested object keys and package entry order', async () => {
    const dir = await createFixture();
    const lockPath = path.join(dir, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    const baseline = await fingerprint(dir);
    const entries = Object.entries(lock.packages).reverse();
    lock.packages = Object.fromEntries(entries.map(([name, data]) => [name,
      Object.fromEntries(Object.entries(data as object).reverse()),
    ]));
    await writeJson(dir, 'package-lock.json', lock);
    expect(await fingerprint(dir)).toBe(baseline);
  });

  it.each([
    ['dependency version', (lock: any) => { lock.packages['node_modules/demo'].version = '2.0.0'; }],
    ['dependency license', (lock: any) => { lock.packages['node_modules/demo'].license = 'MIT'; }],
  ])('changes for %s', async (_label, change) => {
    const dir = await createFixture();
    const lockPath = path.join(dir, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.packages['node_modules/demo'] = { version: '1.0.0', license: 'ISC' };
    await writeJson(dir, 'package-lock.json', lock);
    const baseline = await fingerprint(dir);
    change(lock);
    await writeJson(dir, 'package-lock.json', lock);
    expect(await fingerprint(dir)).not.toBe(baseline);
  });

  it('includes policy changes and remains under 200ms', async () => {
    const dir = await createFixture();
    const before = await fingerprint(dir);
    const start = performance.now();
    const measured = await fingerprint(dir);
    expect(performance.now() - start).toBeLessThan(200);
    const policy = JSON.parse(await readFile(path.join(dir, 'scripts/tools/licenses/policy.json'), 'utf8'));
    policy.allow.reverse();
    await writeJson(dir, 'scripts/tools/licenses/policy.json', policy);
    expect(await fingerprint(dir)).not.toBe(before);
    expect(measured).toBe(before);
  });
});
