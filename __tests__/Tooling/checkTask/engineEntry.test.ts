import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as engine from '@/Engine';
import * as main from '@/Carburetor';
import * as componentLayer from '@/Carburetor/Component/AntiHookComponent/index';
import * as bind from '@/Carburetor/Component/bind';
import * as context from '@/Carburetor/Component/Scope/CarburetorContext';
import * as childScope from '@/Carburetor/Component/Scope/CarburetorChildScope';
import * as provider from '@/Carburetor/Component/Scope/CarburetorProvider';
import * as scoped from '@/Carburetor/Component/ScopedAntiHookComponent';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = path.join(root, 'lib/src/Engine/index.ts');
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
const isReact = (specifier: string): boolean => /^react(-dom)?(\/|$)/.test(specifier);
const REACT_LAYER_FILE =
    /Component\/(AntiHookComponent|bind|ScopedAntiHookComponent)|Scope\/Carburetor(Context|Provider|ChildScope)/;

/** The module file a relative specifier names, if there is one. */
const resolveSource = (from: string, specifier: string): string | undefined => {
    const base = path.resolve(path.dirname(from), specifier);

    return [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
};

/** Every source file reachable from `entry`, and the package specifiers they import. */
const closure = (entry: string): {files: Set<string>; packages: Map<string, string[]>} => {
    const files = new Set<string>();
    const packages = new Map<string, string[]>();
    const queue = [entry];

    while (queue.length > 0) {
        const file = queue.pop() as string;

        if (files.has(file)) continue;

        files.add(file);

        for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
            const specifier = match[1];

            if (!specifier.startsWith('.')) {
                packages.set(specifier, [...(packages.get(specifier) ?? []), path.relative(root, file)]);
                continue;
            }

            const target = resolveSource(file, specifier);

            if (target !== undefined) queue.push(target);
        }
    }

    return {files, packages};
};

/** Every export the React layer of the main entry adds on top of the engine. */
const reactLayer = [componentLayer, bind, context, childScope, provider, scoped];

describe('the engine entry point', () => {
    test('reaches no module that imports react or react-dom', () => {
        const {files, packages} = closure(ENTRY);
        const reached = [...packages].filter(([specifier]) => isReact(specifier));

        // A guard against a walker that finds nothing: the closure must hold the real engine.
        expect(files.size).toBeGreaterThan(100);
        expect([...files].map(file => path.relative(root, file).split(path.sep).join('/')))
            .toContain('lib/src/Carburetor/Store/Carburetor.ts');
        expect(reached).toEqual([]);
    });

    test('does not reach the component layer, the scope context, provider or child boundary', () => {
        const {files} = closure(ENTRY);
        const reached = [...files].map(file => path.relative(root, file).split(path.sep).join('/'))
            .filter(file => REACT_LAYER_FILE.test(file));

        expect(reached).toEqual([]);
    });

    test('is the main entry minus the React layer: nothing is missing and nothing is renamed', () => {
        const layerNames = new Set(reactLayer.flatMap(module => Object.keys(module)));
        const engineNames = Object.keys(engine);

        expect(engineNames.filter(name => layerNames.has(name))).toEqual([]);
        expect([...engineNames, ...layerNames].sort()).toEqual(Object.keys(main).sort());

        for (const name of engineNames) {
            expect((engine as Record<string, unknown>)[name]).toBe((main as Record<string, unknown>)[name]);
        }
    });

    test('keeps the engine classes a consumer needs without React', () => {
        for (const name of ['Carburetor', 'computed', 'persist', 'transaction', 'ResourceCache', 'CarburetorScope',
            'carburetorToken', 'CarburetorHistory', 'diagnostics', 'UpdateThrottle']) {
            expect(engine).toHaveProperty(name);
        }
        for (const name of ['AntiHookComponent', 'bind', 'CarburetorProvider', 'CarburetorContext']) {
            expect(engine).not.toHaveProperty(name);
        }
    });

    test('the built CommonJS entry loads and works while react cannot be resolved', () => {
        const built = path.join(root, 'dist/cjs/Engine/index.js');

        if (!existsSync(built)) throw new Error('dist is not built, run npm run build first: ' + built);

        const script = [
            "const Module = require('node:module');",
            'const resolve = Module._resolveFilename;',
            'Module._resolveFilename = function (request, ...rest) {',
            "    if (request === 'react' || request === 'react-dom' || request.startsWith('react/')",
            "        || request.startsWith('react-dom/')) throw new Error('react was resolved: ' + request);",
            '    return resolve.call(this, request, ...rest);',
            '};',
            'const engine = require(process.env.ENGINE_ENTRY);',
            'class Counter extends engine.Carburetor {',
            '    bump() { this.update(draft => { draft.n++; }); }',
            '    touch() { this.update(draft => { draft.other++; }); }',
            '}',
            'const store = new Counter({n: 0, other: 0});',
            'const seen = [];',
            'const stop = store.watch(data => data.n, (next, previous) => seen.push([previous, next]));',
            'store.bump(); store.touch(); store.bump();',
            'stop();',
            'console.log(JSON.stringify({',
            '    seen, scope: typeof engine.CarburetorScope, persist: typeof engine.persist,',
            "    computed: typeof engine.computed, component: 'AntiHookComponent' in engine,",
            '}));',
        ].join('\n');
        const result = spawnSync(process.execPath, ['-e', script], {
            cwd: root, encoding: 'utf8', env: {...process.env, ENGINE_ENTRY: built},
        });

        expect(result.stderr).not.toContain('react was resolved');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            seen: [[0, 1], [1, 2]], scope: 'function', persist: 'function', computed: 'function', component: false,
        });
    });
});
