import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {select} from '../../../scripts/affected.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const map = JSON.parse(readFileSync(join(root, 'scripts', 'affected.map.json'), 'utf8'));

const noUnmapped = (files) => select(files, map).reasons.filter((r) => r.startsWith('unmapped:'));

const levelDirs = (rel) => {
    const dirs = [];
    for (const entry of readdirSync(join(root, rel), {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const p = rel + '/' + entry.name;
        dirs.push(p);
        for (const child of readdirSync(join(root, p), {withFileTypes: true})) {
            if (child.isDirectory()) dirs.push(p + '/' + child.name);
        }
    }
    return dirs;
};

const gateIds = () => {
    const ids = [];
    for (const f of readdirSync(join(root, 'perf/gates'))) {
        if (!f.endsWith('.mjs')) continue;
        const text = readFileSync(join(root, 'perf/gates', f), 'utf8');
        for (const m of text.matchAll(/id:\s*'([^']+)'/g)) ids.push(m[1]);
    }
    return ids;
};

describe('affected map coverage', () => {
    it('covers every first and second level directory of lib/src and native/src', () => {
        const dirs = [...levelDirs('lib/src'), ...levelDirs('native/src')];
        expect(dirs.length).toBeGreaterThan(0);
        for (const d of dirs) expect(noUnmapped([d])).toEqual([]);
    });

    it('covers every perf/gates file and perf/scenarios subdirectory', () => {
        const gates = readdirSync(join(root, 'perf/gates'))
            .filter((f) => f.endsWith('.mjs')).map((f) => 'perf/gates/' + f);
        const scenarios = readdirSync(join(root, 'perf/scenarios'), {withFileTypes: true})
            .filter((d) => d.isDirectory()).map((d) => 'perf/scenarios/' + d.name);
        expect(gates.length).toBeGreaterThan(0);
        expect(scenarios.length).toBeGreaterThan(0);
        for (const p of [...gates, ...scenarios]) expect(noUnmapped([p])).toEqual([]);
    });

    it('every rstest path in the map exists', () => {
        for (const rule of map.rules) {
            for (const p of rule.rstest || []) expect(existsSync(join(root, p))).toBe(true);
        }
    });

    it('covers documentation builder and example suite mapping', () => {
        const script = 'scripts/tools/buildDocs.mjs';
        const examples = 'examples/readme/Counter.tsx';
        expect(noUnmapped([script, examples])).toEqual([]);
        expect(select([script], map).examples).toBe(true);
        expect(select([examples], map).rstest).toContain('__tests__/Native/examples.test.ts');
    });

    it('resource and component perf areas match their gate families', () => {
        const rule = (m) => map.rules.find((r) => r.match === m);
        expect(rule('lib/src/Carburetor/Resource/**').perfAreas.every((a) =>
            ['resource', 'cache', 'views'].includes(a))).toBe(true);
        for (const a of ['selection', 'readset40', 'iterate40', 'subclass40']) {
            expect(rule('lib/src/Carburetor/Component/**').perfAreas).toContain(a);
        }
    });

    it('every perfArea in the map matches at least one gate id', () => {
        const ids = gateIds();
        expect(ids.length).toBeGreaterThan(0);
        for (const rule of map.rules) {
            for (const a of rule.perfAreas || []) {
                expect(ids.some((id) => id.includes(a))).toBe(true);
            }
        }
    });
});
