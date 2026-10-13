import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
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

    it('resource file selects resource tests without full run', () => {
        const r = select(['lib/src/Carburetor/Resource/createAbortHandle.ts'], map);
        expect(r.full).toBe(false);
        expect(r.rstest).toContain('__tests__/Engine/Resource');
        expect(r.perfAreas).toContain('resource');
    });

    it('store file forces full run', () => {
        const r = select(['lib/src/Carburetor/Store/Carburetor.ts'], map);
        expect(r.full).toBe(true);
    });

    it('docs file is docsOnly', () => {
        const r = select(['docs/guide.md'], map);
        expect(r.docsOnly).toBe(true);
        expect(r.full).toBe(false);
    });

    it('unknown path fails safe with full and unmapped reason', () => {
        const r = select(['random/unknown.bin'], map);
        expect(r.full).toBe(true);
        expect(r.reasons.some((x) => x.startsWith('unmapped: random/unknown.bin'))).toBe(true);
    });

    it('mix of resource and store forces full run', () => {
        const r = select(['lib/src/Carburetor/Resource/a.ts', 'lib/src/Carburetor/Store/b.ts'], map);
        expect(r.full).toBe(true);
    });
});
