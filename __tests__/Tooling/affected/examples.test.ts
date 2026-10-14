import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {select} from '../../../scripts/affected.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const map = JSON.parse(readFileSync(join(root, 'scripts/affected.map.json'), 'utf8'));

const picked = (file) => select([file], map);

describe('affected example selection', () => {
    it('selects docs examples independently without changing docsOnly', () => {
        const readme = picked('README.md');
        expect(readme.docsOnly).toBe(true);
        expect(readme.examples).toBe(true);
        expect(picked('docs/guide.md').examples).toBe(true);
        expect(picked('docs/nested/guide.md').examples).toBe(true);
        expect(picked('docs/reviews/old.md').examples).toBe(false);
        expect(picked('docs/checkpoints/old.md').examples).toBe(false);
        expect(picked('notes.md').examples).toBe(false);
        expect(picked('docs/image.png').examples).toBe(false);
    });

    it('selects public API changes alongside subsystem rules', () => {
        for (const file of [
            'lib/src/Carburetor/Resource/createAbortHandle.ts',
            'lib/src/Carburetor/Component/Reads.tsx',
            'lib/src/Interop/useResourceValue.ts',
        ]) expect(picked(file).examples).toBe(true);
        expect(picked('lib/src/Carburetor/Resource/createAbortHandle.ts').rstest)
            .toContain('__tests__/Engine/Resource');
    });

    it('normalizes windows paths and selects the checker suite', () => {
        const normalized = picked('docs\\nested\\guide.md');
        expect(normalized.examples).toBe(true);
        const checker = picked('scripts/consumer-fixture/checkExamples.mjs');
        expect(checker.examples).toBe(true);
        expect(checker.rstest).toContain('__tests__/Tooling/examples');
        expect(select([], map).examples).toBe(false);
    });

    it('preserves full-tier selection and marks full plans for examples', () => {
        for (const file of ['lib/src/Carburetor/Store/Carburetor.ts', 'unknown/file.bin']) {
            const result = picked(file);
            expect(result.full).toBe(true);
            expect(result.examples).toBe(true);
        }
    });

    it('keeps examples when full tier overrides native and test selections', () => {
        const result = select(['native/src/main.rs', 'package.json'], map);
        expect(result.full).toBe(true);
        expect(result.native).toBe(false);
        expect(result.rstest).toEqual([]);
        expect(result.perfAreas).toEqual([]);
        expect(result.docsOnly).toBe(false);
        expect(result.examples).toBe(true);
    });

    it('keeps docs-only and examples flags for mixed documentation changes', () => {
        const result = select(['README.md', 'docs/reviews/old.md'], map);
        expect(result.docsOnly).toBe(true);
        expect(result.examples).toBe(true);
    });
});
