import {existsSync, readdirSync, readFileSync} from "node:fs";
import * as path from "node:path";

/**
 * Guards the `"use client"` boundary. A module carries the directive exactly when it touches
 * React's client API — a value import from "react" — or imports such a module; barrels never do,
 * since a client boundary cannot `export *`. Everything else stays importable from a React Server
 * Component. The built check matters as much as the source one: the minifier drops the directive
 * unless told otherwise, and CI builds before it tests.
 */
const ROOT: string = process.cwd();
const SOURCE_ROOTS: string[] = ['Carburetor', 'Interop'];
const SRC: string = path.join(ROOT, 'lib', 'src');
const BARREL = /^index\.tsx?$/;
const DIRECTIVE = /^(?:\s*["']use strict["'];?)?\s*["']use client["'];?/;
const REACT_VALUE_IMPORT = /^import\s+(?!type\b)[^;]*?from\s+["']react["']/m;
const IMPORT_FROM = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm;

const FORMATS: {dir: string; extension: string}[] = [
    {dir: 'esm', extension: '.mjs'},
    {dir: 'esm-prod', extension: '.mjs'},
    {dir: 'cjs', extension: '.js'},
    {dir: 'cjs-prod', extension: '.js'},
];

const EXPECTED: string[] = [
    'Carburetor/Component/AntiHookComponent/AntiHookComponent',
    'Carburetor/Component/AntiHookComponent/Effects',
    'Carburetor/Component/AntiHookComponent/Foundation',
    'Carburetor/Component/AntiHookComponent/Reads',
    'Carburetor/Component/AntiHookComponent/Subscriptions',
    'Carburetor/Component/Scope/CarburetorContext',
    'Carburetor/Component/Scope/CarburetorProvider',
    'Carburetor/Component/ScopedAntiHookComponent',
    'Interop/useCarburetorValue',
    'Interop/useComputedValue',
];

const walk = (dir: string): string[] => {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(dir, entry.name);

        return entry.isDirectory() ? walk(full) : [full];
    });
};

/** Source modules keyed by their extensionless path relative to lib/src, with `/` separators. */
const sources = (): Map<string, string> => {
    const modules = new Map<string, string>();

    SOURCE_ROOTS.forEach((root) => {
        walk(path.join(SRC, root))
            .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
            .forEach((file) => {
                const key = path.relative(SRC, file).replace(/\.tsx?$/, '').split(path.sep).join('/');

                modules.set(key, readFileSync(file, 'utf8'));
            });
    });

    return modules;
};

const resolveImport = (from: string, specifier: string, modules: Map<string, string>): string | null => {
    let base: string;

    if (specifier.startsWith('@/')) {
        base = specifier.slice(2);
    } else if (specifier.startsWith('.')) {
        base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    } else {
        return null;
    }

    if (modules.has(base)) {
        return base;
    }

    return modules.has(`${base}/index`) ? `${base}/index` : null;
};

/** React-client modules plus everything importing one, barrels excluded and not traversed. */
const clientModules = (modules: Map<string, string>): Set<string> => {
    const isBarrel = (key: string): boolean => BARREL.test(`${path.posix.basename(key)}.ts`);
    const client = new Set<string>();

    modules.forEach((source, key) => {
        if (!isBarrel(key) && REACT_VALUE_IMPORT.test(source)) {
            client.add(key);
        }
    });

    let grew = true;

    while (grew) {
        grew = false;
        modules.forEach((source, key) => {
            if (client.has(key) || isBarrel(key)) {
                return;
            }

            const imports = [...source.matchAll(IMPORT_FROM)].map((match) => match[1]);

            if (imports.some((specifier) => client.has(resolveImport(key, specifier, modules) ?? ''))) {
                client.add(key);
                grew = true;
            }
        });
    }

    return client;
};

describe('"use client" boundary', () => {
    const modules = sources();
    const client = clientModules(modules);

    test('the client set is the component chain, the context and the hooks', () => {
        expect([...client].sort()).toEqual(EXPECTED);
    });

    test('a source module starts with the directive exactly when it is a client module', () => {
        const mismatched = [...modules].filter(([key, source]) => DIRECTIVE.test(source) !== client.has(key));

        expect(mismatched.map(([key]) => key)).toEqual([]);
    });

    test.each(FORMATS)('every $dir module keeps the directive exactly when its source has it', ({dir, extension}) => {
        const distRoot = path.join(ROOT, 'dist', dir);

        expect(existsSync(distRoot)).toBe(true);

        const emitted = walk(distRoot).filter((file) => file.endsWith(extension));
        const mismatched = emitted.filter((file) => {
            const key = path.relative(distRoot, file).slice(0, -extension.length).split(path.sep).join('/');

            return DIRECTIVE.test(readFileSync(file, 'utf8')) !== client.has(key);
        });

        expect(emitted.length).toBeGreaterThan(EXPECTED.length);
        expect(mismatched.map((file) => path.relative(distRoot, file))).toEqual([]);
    });
});
