import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const scenario = readFileSync(path.join(root, 'scripts/consumer-fixture/sourceCondition.mjs'), 'utf8');
const sourceFiles = (directory: string): string => readdirSync(path.join(root, directory), {withFileTypes: true})
    .flatMap(entry => entry.isDirectory()
        ? sourceFiles(path.join(directory, entry.name))
        : /\.(ts|tsx|mts)$/.test(entry.name) ? [readFileSync(path.join(root, directory, entry.name), 'utf8')] : [])
    .join('\n');

describe('source condition consumer contract', () => {
    test('keeps source targets first for every supported entry', () => {
        const exports = manifest.exports;
        const targets = {'.': './lib/src/Carburetor/index.ts', './interop': './lib/src/Interop/index.ts',
            './testing': './lib/src/Testing/index.ts'};
        for (const [key, target] of Object.entries(targets)) {
            expect(Object.keys(exports[key])[0]).toBe('carburetor-source');
            expect(exports[key]['carburetor-source']).toBe(target);
        }
        expect(exports['./lint']['carburetor-source']).toBeUndefined();
    });

    test('uses source conditions without aliases and covers package internals', () => {
        expect(scenario).toContain("conditionNames: ['carburetor-source', '...']");
        expect(scenario).toContain("customConditions: ['carburetor-source']");
        expect(scenario).toContain("moduleResolution: 'bundler'");
        expect(scenario).toContain('file:${source}');
        expect(scenario).not.toMatch(/alias\s*:/);
        expect(sourceFiles('lib/src')).not.toMatch(/['"]@\//);
    });
});
