import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '<!-- example:compile -->';

/** Names exported by a module file, following `export * from` re-exports. */
const exportedNames = (file: string, seen = new Set<string>()): Set<string> => {
    const names = new Set<string>();
    if (seen.has(file)) return names;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^export \* from '(\.[^']+)';/gm)) {
        const base = path.resolve(path.dirname(file), match[1]);
        const target = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(fs.existsSync);
        if (!target) throw new Error(`cannot resolve ${match[1]} from ${file}`);
        exportedNames(target, seen).forEach(name => names.add(name));
    }
    const kinds = '(?:const|let|class|function|interface|type|enum)';
    const declaration = new RegExp(`^export (?:declare )?(?:abstract )?${kinds} ([A-Za-z_$][\\w$]*)`, 'gm');
    for (const match of source.matchAll(declaration)) names.add(match[1]);
    for (const match of source.matchAll(/^export (?:type )?\{([^}]+)\}/gm)) {
        for (const part of match[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop()?.trim();
            if (name && name !== 'default') names.add(name);
        }
    }
    return names;
};

/** The code of every block marked as a self-contained example in README.md and docs/. */
const markedExamples = (): string[] => {
    const docs = (directory: string): string[] => fs.readdirSync(directory, {withFileTypes: true})
        .flatMap(entry => {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) return ['reviews', 'checkpoints'].includes(entry.name) ? [] : docs(file);
            return entry.name.endsWith('.md') ? [file] : [];
        });
    const blocks: string[] = [];
    for (const file of [path.join(root, 'README.md'), ...docs(path.join(root, 'docs'))]) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() !== marker) continue;
            let start = i + 1;
            while (start < lines.length && !/^\s*```/.test(lines[start])) start++;
            let end = start + 1;
            while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
            blocks.push(lines.slice(start + 1, end).join('\n'));
        }
    }
    return blocks;
};

describe('documentation examples cover the shipped API', () => {
    const examples = markedExamples().join('\n');
    const entryPoints: Array<[string, string]> = [
        ['react-carburetor', 'lib/src/Carburetor/index.ts'],
        ['react-carburetor/interop', 'lib/src/Interop/index.ts'],
        ['react-carburetor/lint', 'plugin/lint.d.ts'],
    ];

    test.each(entryPoints)('every export of %s appears in a marked example', (_entry, file) => {
        const names = [...exportedNames(path.join(root, file))];
        expect(names.length).toBeGreaterThan(0);
        const missing = names.filter(name => !new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(examples));
        expect(missing).toEqual([]);
    });

    test('control: a name that no example uses is reported missing', () => {
        expect(/\bNotAnExportedCarburetorName\b/.test(examples)).toBe(false);
    });
});
