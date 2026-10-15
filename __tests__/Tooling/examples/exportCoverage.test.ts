import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();

/** Exported names behind `export *` barrels, found via multiline regexes. */
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
        /^export (?:declare )?(?:abstract )?(?:default )?(?:const|let|class|function|interface|type|enum) ([\w$]+)/gm;
    for (const match of source.matchAll(declarations)) {
        names.add(match[1]);
    }
    for (const match of source.matchAll(/^export (?:type )?\{([^}]+)\}/gm)) {
        for (const name of match[1].split(',')) {
            const exposed = name.trim().split(/\s+as\s+/).at(-1);
            if (exposed && exposed !== 'default') names.add(exposed);
        }
    }
    if (/^export default/gm.test(source)) names.add('default');
    return names;
};

/** Identifiers in non-comment code (comments stripped) of the proper, runnable examples. */
const stripComments = (source: string): string => {
    let result = '';
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];
        if (char === '/' && next === '/') {
            while (index < source.length && source[index] !== '\n') index++;
        } else if (char === '/' && next === '*') {
            index += 2;
            while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++;
            index += 2;
        } else {
            result += char;
            index++;
        }
    }
    return result;
};

const exampleIdentifiers = (directory: string): Set<string> => {
    const result = new Set<string>();
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (/\.(?:ts|tsx)$/.test(entry.name) && !file.split(path.sep).includes('wrong')) {
                const code = stripComments(fs.readFileSync(file, 'utf8'));
                for (const identifier of code.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
                    result.add(identifier[0]);
                }
            }
        }
    };
    walk(directory);
    return result;
};

describe('runnable examples cover the public API', () => {
    const covered = exampleIdentifiers(path.join(root, 'examples'));
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

describe('coverage helpers', () => {
    const tmpdirs: string[] = [];
    const makeTempDir = (): string => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-coverage-'));
        tmpdirs.push(dir);
        return dir;
    };
    afterAll(() => {
        for (const dir of tmpdirs) fs.rmSync(dir, {recursive: true, force: true});
    });

    test('exportedNames sees a declaration that is not the first line of the file', () => {
        const dir = makeTempDir();
        const file = path.join(dir, 'index.ts');
        fs.writeFileSync(file, 'import \'./side\';\nexport const first = 1;\nexport const second = 2;\n');
        const names = exportedNames(file);
        expect(names.has('first')).toBe(true);
        expect(names.has('second')).toBe(true);
    });

    test('usage is only counted in non-comment code', () => {
        const dir = makeTempDir();
        const examples = path.join(dir, 'examples', 'nested');
        fs.mkdirSync(examples, {recursive: true});
        fs.writeFileSync(
            path.join(examples, 'usage.ts'),
            [
                '// CommentOnlyApi is mentioned in a line comment.',
                '/* BlockOnlyApi is mentioned in a block comment. */',
                'const real = 1; // trailing comment mentions TrailingApi',
            ].join('\n'),
        );
        const identifiers = exampleIdentifiers(path.join(dir, 'examples'));
        expect(identifiers.has('CommentOnlyApi')).toBe(false);
        expect(identifiers.has('BlockOnlyApi')).toBe(false);
        expect(identifiers.has('TrailingApi')).toBe(false);
        expect(identifiers.has('real')).toBe(true);
    });
});
