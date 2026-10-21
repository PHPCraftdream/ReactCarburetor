import { describe, expect, it } from '@rstest/core';
import { parseLicense } from '../../../scripts/tools/licenses/parseLicense.mjs';
import { collectNpm } from '../../../scripts/tools/licenses/collectNpm.mjs';
import { collectRust } from '../../../scripts/tools/licenses/collectRust.mjs';
import { evaluate } from '../../../scripts/tools/licenses/evaluate.mjs';
import policy from '../../../scripts/tools/licenses/policy.json' with { type: 'json' };

const parse = (value, scope = 'shipped') => parseLicense(value, policy, scope);

describe('license policy behavior', () => {
  it('rejects malformed expressions rather than extracting a permitted token', () => {
    expect(parse('MIT!!!')).toBe('unknown');
  });
  it('chooses the least restrictive alternative and strictest conjunction', () => {
    expect(parseLicense('MIT OR GPL-3.0-only', policy)).toBe('allowed');
    expect(parseLicense('MIT AND GPL-3.0-only', policy, 'dev')).toBe('review');
  });
  it('requires versioned exact exceptions and detects stale entries', () => {
    const entry = { ecosystem: 'npm', name: 'sample', version: '1.0.0', license: 'MPL-2.0', reason: 'reviewed' };
    expect(evaluate([
      { ...entry, scope: 'shipped', path: 'node_modules/sample', license: 'UNKNOWN', missingLicense: true },
    ], { ...policy, exceptions: [{ ...entry, license: 'UNKNOWN' }] }).ok).toBe(true);
    expect(evaluate([], { ...policy, exceptions: [entry] }).stale).toHaveLength(1);
  });
  it('applies exact exceptions to unknown licenses but not prohibited licenses', () => {
    const record = {
      ecosystem: 'npm', name: 'sample', version: '1.0.0', license: 'UNKNOWN',
      scope: 'shipped', path: 'node_modules/sample', missingLicense: true,
    };
    const exception = {
      ecosystem: 'npm', name: 'sample', version: '1.0.0', license: 'UNKNOWN',
      reason: 'metadata verified manually',
    };
    const accepted = evaluate([record], { ...policy, exceptions: [exception] });
    expect(accepted.ok).toBe(true);
    expect(accepted.rows[0].status).toBe('review');
    const denied = { ...record, license: 'GPL-3.0-only', missingLicense: false };
    const deniedException = { ...exception, license: 'GPL-3.0-only' };
    expect(evaluate([denied], { ...policy, exceptions: [deniedException] }).violations).toHaveLength(1);
  });
  it('marks wrong-name, wrong-version, malformed, and duplicate exceptions stale', () => {
    const record = {
      ecosystem: 'npm', name: 'sample', version: '1.0.0', license: 'UNKNOWN',
      scope: 'shipped', path: 'node_modules/sample',
    };
    const exact = { ecosystem: 'npm', name: 'sample', version: '1.0.0', license: 'UNKNOWN', reason: 'verified' };
    const result = evaluate([record], {
      ...policy,
      exceptions: [
        exact, { ...exact, version: '2.0.0' }, { ...exact, name: 'other' },
        { reason: 'missing keys' }, exact,
      ],
    });
    expect(result.stale).toHaveLength(5);
    expect(result.ok).toBe(false);
  });
  it('ignores Rust exceptions when evaluating only npm records', () => {
    const exception = { ecosystem: 'cargo', name: 'crate', version: '1.0.0', license: 'UNKNOWN', reason: 'reviewed' };
    const result = evaluate([], { ...policy, exceptions: [exception] }, { ecosystems: ['npm'] });
    expect(result.stale).toHaveLength(0);
    expect(result.ok).toBe(true);
  });
  it('retains peers and optional production dependencies and fails closed on absent metadata', () => {
    const records = collectNpm({ lockfileVersion: 3, packages: {
      '': {}, 'node_modules/a': { version: '1', license: 'MIT' },
            'node_modules/b': { version: '2', optional: true },
      'node_modules/c': { version: '3', peer: true, license: 'BSD-3-Clause' },
    } });
    expect(records.find(x => x.name === 'b').license).toBe('UNKNOWN');
    expect(records).toHaveLength(3);
  });
  it('propagates Rust root context through transitive build and dev edges', () => {
    const metadata = { packages: [
      { id: 'root', name: 'root', version: '1', license: 'MIT', manifest_path: '/root/Cargo.toml' },
      { id: 'build', name: 'build', version: '1', license: 'MIT' },
      { id: 'transitive', name: 'transitive', version: '1', license: 'MIT' }
    ], workspace_members: ['root'], resolve: { nodes: [
      { id: 'root', deps: [{ pkg: 'build', dep_kinds: [{ kind: 'build', target: null }] }] },
      { id: 'build', deps: [{ pkg: 'transitive', dep_kinds: [{ kind: null, target: null }] }] },
      { id: 'transitive', deps: [] }
    ] } };
    expect(collectRust(metadata).find(x => x.name === 'transitive').scope).toBe('dev');
  });
});
