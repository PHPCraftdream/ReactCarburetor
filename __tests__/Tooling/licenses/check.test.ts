import { describe, expect, it } from '@rstest/core';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const checker = path.join(root, 'scripts/tools/licenses/check.mjs');

describe('license checker integration', () => {
  it('rejects invalid arguments and avoids invoking Cargo locally', () => {
    const run = args => spawnSync(process.execPath, [checker, ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'false' },
    });
    expect(run(['--unexpected']).status).not.toBe(0);
    expect(run(['--metadata']).stderr).toContain('requires exactly one');
    expect(run([]).stderr).toContain('CI=true');
  });

  it('reports metadata fixture violations, warnings, and allowed alternatives', async () => {
    const directory = await mkdtemp(path.join(root, '__tests__/Tooling/licenses/check-'));
    try {
      const fixture = path.join(directory, 'metadata.json');
      const metadata = license => ({
        packages: [
          { id: 'root', name: 'root', version: '1.0', license: 'MIT' },
          { id: 'fixture', name: 'fixture', version: '1.0', license },
        ],
        workspace_members: ['root'],
        resolve: { nodes: [
          { id: 'root', deps: [{ pkg: 'fixture', dep_kinds: [{ kind: null, target: null }] }] },
          { id: 'fixture', deps: [] },
        ] },
      });
      const runCheck = (args, env = {}) => {
        const result = spawnSync(process.execPath, [checker, ...args], {
          cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
        });
        if (result.error) throw result.error;
        return result;
      };
      await writeFile(fixture, JSON.stringify(metadata('GPL-3.0-only')));
      expect(runCheck(['--metadata', fixture]).status).not.toBe(0);
      await writeFile(fixture, JSON.stringify(metadata('MIT OR GPL-3.0-only')));
      const allowed = runCheck(['--metadata', fixture]);
      expect(allowed.status).toBe(0);
      expect(allowed.stdout).toContain('Dependency license report');
      await writeFile(fixture, JSON.stringify(metadata('MPL-2.0')));
      expect(runCheck(['--metadata', fixture]).stdout).toContain('Review (');
      const gplDev = { ...metadata('GPL-3.0-only'), resolve: { nodes: [
        { id: 'root', deps: [{ pkg: 'fixture', dep_kinds: [{ kind: 'dev', target: null }] }] },
        { id: 'fixture', deps: [] },
      ] } };
      await writeFile(fixture, JSON.stringify(gplDev));
      const devResult = runCheck(['--metadata', fixture]);
      expect(devResult.status).toBe(0);
      expect(devResult.stdout).toContain('### Review (1)');
      await writeFile(fixture, JSON.stringify(metadata('MIT')));
      const summary = path.join(directory, 'summary.md');
      runCheck(['--metadata', fixture], { GITHUB_STEP_SUMMARY: summary });
      expect(await readFile(summary, 'utf8')).toContain('| Ecosystem | Scope | License | Count |');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the workflow pinned like ci.yml, cache-gated and ordered', async () => {
    const text = await readFile(path.join(root, '.github/workflows/licenses.yml'), 'utf8');
    const ci = await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(text.split('\n').every(line => line.length <= 130)).toBe(true);
    for (const action of ['actions/checkout', 'actions/setup-node', 'actions/cache']) {
      const pin = text.match(new RegExp('uses: (' + action + '@[0-9a-f]{40})'))?.[1];
      expect(pin).toBeDefined();
      expect(ci).toContain(pin as string);
    }
    const order = ['Fingerprint dependency inputs', 'Successful-check marker', 'Collect Rust dependency metadata',
      'Check licenses', 'Remember the passing check'].map(name => text.indexOf('- name: ' + name));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('key: licenses-ok-${{ steps.fingerprint.outputs.value }}');
    expect(text).toContain("github.event.inputs.force != 'true'");
    expect(text).toContain('cargo metadata --format-version 1 --locked --manifest-path native/Cargo.toml');
    expect(text.split('$RUNNER_TEMP/cargo-metadata.json')).toHaveLength(3);
    for (const file of ['native/Cargo.toml', 'native/Cargo.lock', 'package-lock.json']) {
      expect(text.split(file).length).toBeGreaterThanOrEqual(3);
    }
  });
});
