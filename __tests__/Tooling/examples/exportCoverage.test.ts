import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

/** Exported names behind `export *` barrels. */
const exportedNames = (file: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(file)) return new Set();
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const names = new Set<string>();
    for (const match of source.matchAll(/^export \* from '([^']+)';/gm)) {
        const base = path.resolve(path.dirname(file), match[1]);
        const target = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(fs.existsSync);
        if (!target) throw new Error(`cannot resolve ${match[1]} from ${file}`);
        exportedNames(target, seen).forEach(name => names.add(name));
    }
    const declarations =
        /^export (?:declare )?(?:abstract )?(?:const|let|class|function|interface|type|enum) ([\w$]+)/g;
    for (const match of source.matchAll(declarations)) {
        names.add(match[1]);
    }
    for (const match of source.matchAll(/^export (?:type )?\{([^}]+)\}/gm)) {
        for (const name of match[1].split(',')) {
            const exposed = name.trim().split(/\s+as\s+/).at(-1);
            if (exposed && exposed !== 'default') names.add(exposed);
        }
    }
    if (/^export default/m.test(source)) names.add('default');
    return names;
};

/** Identifiers actually referenced by the proper, runnable examples. */
const exampleIdentifiers = (): Set<string> => {
    const result = new Set<string>();
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (/\.(?:ts|tsx)$/.test(entry.name) && !file.split(path.sep).includes('wrong')) {
                for (const identifier of fs.readFileSync(file, 'utf8').matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
                    result.add(identifier[0]);
                }
            }
        }
    };
    walk(path.join(root, 'examples'));
    return result;
};

describe('runnable examples cover the public API', () => {
    const covered = exampleIdentifiers();
    const entryPoints: Array<[string, string]> = [
        ['react-carburetor', 'lib/src/Carburetor/index.ts'],
        ['react-carburetor/interop', 'lib/src/Interop/index.ts'],
        ['react-carburetor/lint', 'plugin/lint.d.ts'],
    ];
    test.each(entryPoints)('every export of %s is used by an example', (_entry, file) => {
        const names = [...exportedNames(path.join(root, file))];
        expect(names.length).toBeGreaterThan(0);
        expect(names.filter(name => !covered.has(name))).toEqual([]);
    });
    test('control: an absent API name is not covered', () => {
        expect(covered.has('NotAnExportedCarburetorName')).toBe(false);
    });
});
