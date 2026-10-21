import { describe, expect, it } from '@rstest/core';
import { collectNpm } from '../../../scripts/tools/licenses/collectNpm.mjs';
import { collectRust } from '../../../scripts/tools/licenses/collectRust.mjs';

describe('npm collector', () => {
  it('retains missing licenses and lockfile dependency flags', () => {
    const records = collectNpm({ lockfileVersion: 3, packages: {
      '': { devDependencies: { rootDev: '1' } },
      'node_modules/prod': { version: '1', license: 'MIT' },
      'node_modules/rootDev': { version: '1', dev: true },
      'node_modules/optional': { version: '1', optional: true, peer: true },
    } });
    expect(records.find(record => record.name === 'prod').scope).toBe('shipped');
    expect(records.find(record => record.name === 'rootDev').scope).toBe('dev');
    expect(records.find(record => record.name === 'optional')).toMatchObject({
      license: 'UNKNOWN', missingLicense: true, optional: true, peer: true,
    });
  });
});

describe('Rust collector', () => {
  it('classifies normal, build, dev, transitive, and shared paths', () => {
    const ids = ['root', 'normal', 'build', 'dev', 'transitive', 'shared'];
    const packages = ids.map(name => ({ id: name, name, version: '1.0', license: name === 'dev' ? undefined : 'MIT' }));
    const edges = {
      root: [['normal', null], ['build', 'build'], ['dev', 'dev'], ['shared', null]],
      normal: [['transitive', null], ['shared', null]],
      build: [['transitive', null]], dev: [['transitive', null]],
      transitive: [], shared: [],
    };
    const metadata = {
      packages, workspace_members: ['root'],
      resolve: { nodes: ids.map(id => ({ id, deps: edges[id].map(([pkg, kind]) => ({
        pkg, dep_kinds: [{ kind, target: null }],
      })) })) },
    };
    const records = collectRust(metadata);
    expect(records).toHaveLength(5);
    expect(records.find(record => record.name === 'normal').scope).toBe('shipped');
    expect(records.find(record => record.name === 'build').scope).toBe('dev');
    expect(records.find(record => record.name === 'dev')).toMatchObject({ license: 'UNKNOWN', missingLicense: true });
    expect(records.find(record => record.name === 'transitive').scope).toBe('shipped');
    expect(records.find(record => record.name === 'shared').scope).toBe('shipped');
    expect(records.find(record => record.name === 'shared').incoming.length).toBeGreaterThan(1);
  });

  it('upgrades dev reachability to shipped without dropping incoming paths', () => {
    const packages = [
      { id: 'workspace 1.0 (path+file:///root)', name: 'root', version: '1.0' },
      { id: 'build 2.0 (registry)', name: 'builder', version: '2.0' },
      { id: 'shared 3.0 (registry)', name: 'shared', version: '3.0' },
    ];
    const [root, build, shared] = packages.map(pkg => pkg.id);
    const metadata = {
      packages, workspace_members: [root],
      resolve: { nodes: [
        { id: root, deps: [
          { pkg: build, dep_kinds: [{ kind: 'build', target: null }] },
          { pkg: shared, dep_kinds: [{ kind: null, target: null }] },
        ] },
        { id: build, deps: [{ pkg: shared, dep_kinds: [{ kind: null, target: null }] }] },
        { id: shared, deps: [] },
      ] },
    };
    const records = collectRust(metadata);
    const sharedRecord = records.find(record => record.name === 'shared');
    expect(sharedRecord.scope).toBe('shipped');
    expect(sharedRecord.incoming).toHaveLength(2);
    expect(sharedRecord.incoming.map(edge => edge.parent).sort()).toEqual(['builder@2.0', 'root@1.0']);
  });

  it('rejects invalid dependency kinds for an existing package', () => {
    const metadata = {
      packages: [{ id: 'root-id', name: 'root', version: '1' }, { id: 'dep-id', name: 'dep', version: '1' }],
      workspace_members: ['root-id'],
      resolve: { nodes: [
        { id: 'root-id', deps: [{ pkg: 'dep-id', dep_kinds: [{ kind: 'other', target: null }] }] },
        { id: 'dep-id', deps: [] },
      ] },
    };
    expect(() => collectRust(metadata)).toThrow();
  });

  it('fails closed on missing graph nodes and unknown dependency kinds', () => {
    const metadata = {
      packages: [{ id: 'root', name: 'root', version: '1' }], workspace_members: ['root'],
      resolve: { nodes: [{ id: 'root', deps: [{ pkg: 'missing', dep_kinds: [{ kind: null }] }] }] },
    };
    expect(() => collectRust(metadata)).toThrow();
  });
});
