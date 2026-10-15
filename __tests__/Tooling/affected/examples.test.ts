import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {select} from '../../../scripts/affected.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const map = JSON.parse(readFileSync(join(root, 'scripts/affected.map.json'), 'utf8'));
const picked = (file: string) => select([file], map);

describe('affected example selection', () => {
    it('selects docs and examples independently from docsOnly', () => {
        expect(picked('README.md')).toMatchObject({docsOnly: true, examples: true});
        expect(picked('docs/examples/stores.md').examples).toBe(true);
        expect(picked('docs/reviews/old.md').examples).toBe(false);
        expect(picked('docs/checkpoints/old.md').examples).toBe(false);
        expect(picked('examples/components/AutosaveDraft.tsx').examples).toBe(true);
        expect(picked('examples/wrong/no-get-data-in-render/Counter.tsx').rstest)
            .toContain('__tests__/Native/examples.test.ts');
        expect(picked('notes.md').examples).toBe(false);
    });

    it('selects builder and public API changes with example coverage', () => {
        expect(picked('scripts/tools/buildDocs.mjs')).toMatchObject({examples: true});
        expect(picked('lib/src/Interop/useResourceValue.ts').examples).toBe(true);
        expect(picked('scripts/tools/buildDocs.mjs').rstest).toContain('__tests__/Tooling/examples');
    });

    it('retains coverage on full plans and normalizes Windows paths', () => {
        expect(picked('examples\\readme\\Counter.tsx').examples).toBe(true);
        const full = picked('package.json');
        expect(full.full).toBe(true);
        expect(full.examples).toBe(true);
        expect(select([], map).examples).toBe(false);
    });
});
