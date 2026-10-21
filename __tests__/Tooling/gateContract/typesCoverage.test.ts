/**
 * Tooling gate: every *.types.ts(x) / *.typing.ts(x) / *.types.test.ts(x) file under __tests__
 * must be compiled by tsconfig.types.json — either listed in its `files` array or imported
 * (directly) by a listed file. Guards against stale entries and silently-unchecked type tests.
 */

import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';

const root = resolve(__dirname, '../../..');

function readListedFiles(): string[] {
    const cfg = JSON.parse(readFileSync(join(root, 'tsconfig.types.json'), 'utf8'));
    if (Array.isArray(cfg.files)) return cfg.files;
    // legacy configs use include; tolerate until migrated
    return cfg.include ?? [];
}

function walkTests(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walkTests(p));
        else if (/\.(?:types(?:\.test)?|typing)\.tsx?$/.test(name)) out.push(p);
    }
    return out;
}

// resolve a specifier from a listed file: exact, +ext, or index
function resolveSpec(fromDir: string, spec: string): string | null {
    const base = spec.startsWith('@/')
        ? join(root, 'src', spec.slice(2))
        : resolve(fromDir, spec);
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
    ];
    for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
    return null;
}

function importsOf(file: string): Set<string> {
    const src = readFileSync(file, 'utf8');
    const specs = [
        ...src.matchAll(/(?:from\s*|import\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g),
    ]
        .map((m) => m[1])
        .filter((s) => s.startsWith('.') || s.startsWith('@/'));
    const out = new Set<string>();
    for (const spec of specs) {
        const r = resolveSpec(dirname(file), spec);
        if (r) out.add(r);
    }
    return out;
}

describe('tsconfig.types.json coverage of type tests', () => {
    test('every listed path exists', () => {
        const listed = readListedFiles();
        expect(listed.length).toBeGreaterThan(0);
        const missing = listed.filter((f) => !existsSync(join(root, f)));
        expect(missing).toEqual([]);
    });

    test('every type-test file is compiled by tsconfig.types.json', () => {
        const listed = readListedFiles();
        const listedAbs = listed.map((f) => join(root, f));
        const imported = new Set<string>();
        for (const f of listedAbs) if (existsSync(f)) for (const i of importsOf(f)) imported.add(i);

        const collected = walkTests(join(root, '__tests__'));
        expect(collected.length).toBeGreaterThan(0);

        const unlisted = collected.filter((f) => !listedAbs.includes(f) && !imported.has(f));
        expect(unlisted).toEqual([]);
    });
});
