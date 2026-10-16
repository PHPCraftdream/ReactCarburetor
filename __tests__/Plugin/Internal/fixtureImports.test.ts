import {readFileSync} from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURES = [
    'examples/wrong/no-memo-over-store-read/MemoOverStoreRead.tsx',
    'plugin/__fixtures__/function-components.tsx',
];

function importsUseMemo(sourceText: string): boolean {
    return [...sourceText.matchAll(/^\s*import\s+(?!type\b)(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])react\2/gm)]
        .some(([, imports]) => imports.split(',').some(binding => {
            const [imported, local] = binding.trim().split(/\s+as\s+/);
            return !/^type\b/.test(imported.trim())
                && imported.trim() === 'useMemo'
                && (local === undefined || local.trim() === 'useMemo');
        }));
}

describe('fixture React imports', () => {
    test('recognizes an executable useMemo import', () => {
        expect(importsUseMemo("import {useMemo} from 'react';")).toBe(true);
    });

    test.each([
        ['missing', "import {useState} from 'react';"],
        ['aliased binding', "import {useMemo as memo} from 'react';"],
        ['type-only declaration', "import type {useMemo} from 'react';"],
        ['type-only binding', "import {type useMemo} from 'react';"],
    ])('does not count %s', (_caseName, source) => {
        expect(importsUseMemo(source)).toBe(false);
    });

    test.each(FIXTURES)('%s imports useMemo from react', fixture => {
        const fileName = path.join(ROOT, fixture);
        expect(importsUseMemo(readFileSync(fileName, 'utf8'))).toBe(true);
    });
});
