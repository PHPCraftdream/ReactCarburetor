import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {select} from '../../../scripts/affected.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const map = JSON.parse(readFileSync(join(root, 'scripts', 'affected.map.json'), 'utf8'));

describe('affected select', () => {
    it('is pure: same input gives same output and map is not mutated', () => {
        const snapshot = JSON.stringify(map);
        const a = select(['lib/src/Carburetor/Resource/Cache/x.ts'], map);
        const b = select(['lib/src/Carburetor/Resource/Cache/x.ts'], map);
        expect(a).toEqual(b);
        expect(JSON.stringify(map)).toBe(snapshot);
    });

    it('resource file selects resource and cross-subsystem tests without full run', () => {
        const r = select(['lib/src/Carburetor/Resource/ResourceCarburetor.ts'], map);
        expect(r.full).toBe(false);
        expect(r.rstest).toContain('__tests__/Engine/Resource');
        const lifecycle = '__tests__/Engine/Component/AntiHookComponent/lifecycle/';
        expect(r.rstest).toContain(lifecycle + 'deferred-resources.test.tsx');
        expect(r.rstest).toContain(lifecycle + 'strict-mode.test.tsx');
        expect(r.perfAreas).toContain('resource');
    });

    it('external plan.json does not affect CLI collected files', () => {
        const run = () => spawnSync(
            process.execPath,
            [join(root, 'scripts', 'affected.mjs'), '--base', 'HEAD', '--json'],
            {cwd: root, encoding: 'utf8'},
        );
        const before = run();
        expect(before.status).toBe(0);
        const temp = mkdtempSync(join(tmpdir(), 'affected-plan-'));
        try {
            writeFileSync(join(temp, 'plan.json'), '{}');
            const after = run();
            expect(after.status).toBe(0);
            const beforePlan = JSON.parse(before.stdout);
            const afterPlan = JSON.parse(after.stdout);
            expect(afterPlan).toEqual(beforePlan);
            expect(afterPlan.files).not.toContain('plan.json');
        } finally {
            rmSync(temp, {recursive: true, force: true});
        }
    });

    it('an unreachable base commit fails safe with a full run', () => {
        const run = spawnSync(
            process.execPath,
            [join(root, 'scripts', 'affected.mjs'), '--base', '0123456789abcdef0123456789abcdef01234567', '--json'],
            {cwd: root, encoding: 'utf8'},
        );
        expect(run.status).toBe(0);
        const plan = JSON.parse(run.stdout);
        expect(plan.full).toBe(true);
        expect(plan.examples).toBe(true);
        expect(plan.reasons.join('\n')).toContain('base unreachable');
    });

    it('store file forces full run', () => {
        const r = select(['lib/src/Carburetor/Store/Carburetor.ts'], map);
        expect(r.full).toBe(true);
    });

    it('root plan is unmapped and fails safe with full run', () => {
        const r = select(['plan.json'], map);
        expect(r.full).toBe(true);
        expect(r.reasons).toContain('unmapped: plan.json');
    });

    it('docs-only invariant holds for representative files from every rule, including perf and mixed docs', () => {
        for (const rule of map.rules) {
            const sample = rule.match.replace('/**', '/representative.ts').replace('*', 'representative');
            const r = select([sample], map);
            if (rule.docsOnly) {
                expect(r.docsOnly).toBe(true);
                expect(r.full).toBe(false);
                expect(r.native).toBe(false);
                expect(r.rstest).toEqual([]);
                expect(r.perfAreas).toEqual([]);
            } else expect(r.docsOnly).toBe(false);
        }
        for (const sample of ['perf/gates/resource.mjs', 'perf/scenarios/resource42/boundaries.mjs']) {
            const r = select([sample], map);
            expect(r.docsOnly).toBe(false);
            expect(r.perfAreas.length).toBeGreaterThan(0);
        }
        const mixed = select(['docs/guide.md', 'perf/gates/resource.mjs'], map);
        expect(mixed.docsOnly).toBe(false);
        expect(mixed.perfAreas.length).toBeGreaterThan(0);
    });

    it('adds transitive reverse scenario families from relative imports', () => {
        expect(select(['perf/scenarios/resource42/boundaries.mjs'], map).perfAreas).toContain('components42');
        expect(select(['perf/scenarios/computed42/snapshots.mjs'], map).perfAreas).toContain('computed43');
    });

    it('maps Component imports to Resource readers and Derived tests', () => {
        const r = select(['lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx'], map);
        expect(r.rstest).toContain('__tests__/Engine/Derived');
        expect(r.rstest).toContain('__tests__/Engine/Resource/ResourceCache/Views');
        expect(r.rstest).toContain('__tests__/Engine/Resource/ResourceCache/Regressions');
    });

    it('Interop and Component changes select the React 18 leg, full tier implies it, Resource does not', () => {
        expect(select(['lib/src/Interop/useResourceValue.ts'], map).react18).toBe(true);
        expect(select(['lib/src/Carburetor/Component/AntiHookComponent/Reads.tsx'], map).react18).toBe(true);
        expect(select(['lib/src/Carburetor/Store/Carburetor.ts'], map).react18).toBe(true);
        expect(select(['lib/src/Carburetor/Resource/x.ts'], map).react18).toBe(false);
    });

    it('global test helpers select the full tier', () => {
        expect(select(['__tests__/setupTests.ts'], map).full).toBe(true);
        expect(select(['__tests__/reactActEnvironment.ts'], map).full).toBe(true);
    });

    it('test helper selects its dependent suites instead of itself', () => {
        const r = select(['__tests__/Engine/Resource/ResourceCache/Helpers/TestCache.ts'], map);
        expect(r.full).toBe(false);
        expect(r.rstest).not.toContain('__tests__/Engine/Resource/ResourceCache/Helpers/TestCache.ts');
        expect(r.rstest.length).toBeGreaterThanOrEqual(5);
        expect(r.rstest.every((p) => /\.test\.tsx?$/.test(p))).toBe(true);
        expect(r.rstest.filter((p) => p.startsWith('__tests__/Engine/Resource/ResourceCache/')).length)
            .toBeGreaterThanOrEqual(5);
    });

    it('component test helper selects at least 10 dependent suites', () => {
        const r = select(['__tests__/Engine/Component/AntiHookComponent/support.tsx'], map);
        expect(r.full).toBe(false);
        expect(r.rstest.length).toBeGreaterThanOrEqual(10);
        expect(r.rstest.every((p) => /\.test\.tsx?$/.test(p))).toBe(true);
    });

    it('resource rule includes the custom resource source suite', () => {
        expect(select(['lib/src/Carburetor/Resource/Slot/prepareSlotRequest.ts'], map).rstest)
            .toContain('__tests__/Engine/Component/AntiHookComponent/lifecycle/custom-resource-source.test.tsx');
    });

    it('native changes run the JS-side native suites', () => {
        expect(select(['native/src/config.rs'], map).rstest).toContain('__tests__/Native');
    });

    it('resource rule includes views perf area', () => {
        expect(select(['lib/src/Carburetor/Resource/x.ts'], map).perfAreas).toContain('views');
    });

    it('component rule includes all component perf areas', () => {
        const areas = select(['lib/src/Carburetor/Component/y.tsx'], map).perfAreas;
        for (const a of ['selection', 'readset40', 'iterate40', 'subclass40']) {
            expect(areas).toContain(a);
        }
    });

    it('keeps unmapped changes safe and mixed mapped/full selection full', () => {
        const unknown = select(['random/unknown.bin'], map);
        expect(unknown.full).toBe(true);
        expect(unknown.reasons).toContain('unmapped: random/unknown.bin');
        expect(select(['lib/src/Carburetor/Resource/a.ts', 'lib/src/Carburetor/Store/b.ts'], map).full).toBe(true);
    });

    it('covers subsystem import edges', () => {
        const roots = [
            'lib/src/Interop',
            'lib/src/Carburetor/Resource',
            'lib/src/Carburetor/Component',
            'lib/src/Carburetor/Derived',
        ];
        const pairs = new Set();
        const edges = [];
        const walk = (dir) => {
            for (const entry of readdirSync(join(root, dir), {withFileTypes: true})) {
                const path = dir + '/' + entry.name;
                if (entry.isDirectory()) walk(path);
                else if (/\.(?:ts|tsx)$/.test(entry.name)) {
                    const text = readFileSync(join(root, path), 'utf8');
                    const owner = roots.find((prefix) => path.startsWith(prefix + '/'));
                    const imports = [...text.matchAll(/\bimport\s+(?:[^;]*?\sfrom\s*)?['"]([^'"]+)['"]/g)];
                    for (const match of imports) {
                        const specifier = match[1];
                        const targetPath = specifier.startsWith('@/')
                            ? 'lib/src/' + specifier.slice(2)
                            : specifier.startsWith('.')
                                ? relative(root, resolve(root, dirname(path), specifier)).replace(/\\/g, '/')
                                : '';
                        const target = roots.find((prefix) =>
                            targetPath === prefix || targetPath.startsWith(prefix + '/'));
                        if (target && owner !== target) {
                            pairs.add(owner + '>' + target);
                            edges.push([path, targetPath, target]);
                        }
                    }
                }
            }
        };
        for (const dir of roots) walk(dir);
        expect(pairs.size).toBeGreaterThanOrEqual(5);
        const targetTests = new Map([
            [roots[0], ['__tests__/Engine/Derived/Readable/Interop']],
            [roots[1], ['__tests__/Engine/Resource']],
            [roots[2], ['__tests__/Engine/Component']],
            [roots[3], ['__tests__/Engine/Derived']],
        ]);
        for (const [source, , target] of edges) {
            const selected = select([source], map);
            expect(selected.full || targetTests.get(target).some((p) =>
                selected.rstest.some((got) => got === p || got.startsWith(p + '/')))).toBe(true);
        }
        expect(select(['lib/src/Interop/useResourceValue.ts'], map).rstest)
            .toContain('__tests__/Engine/Derived/Readable/Interop');
    });
});
