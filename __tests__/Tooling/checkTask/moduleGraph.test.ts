import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCES = path.join(root, 'lib/src');
/** Value imports and re-exports only: `import type` and `export type` are erased by the build. */
const VALUE_IMPORT = /^(?:import|export)\s+(type\s+)?[^;]*?\s+from\s+['"](\.[^'"]+)['"]/gm;

const relative = (file: string): string => path.relative(SOURCES, file).split(path.sep).join('/');

const sourceFiles = (directory: string): string[] => readdirSync(directory, {withFileTypes: true})
    .flatMap(entry => {
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) return entry.name === 'ToDo' ? [] : sourceFiles(full);

        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
    });

const resolveSource = (from: string, specifier: string): string | undefined => {
    const base = path.resolve(path.dirname(from), specifier);

    return [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
};

/** The library's module graph over value imports, keyed by path relative to `lib/src`. */
const buildGraph = (): Map<string, string[]> => {
    const graph = new Map<string, string[]>();

    for (const file of sourceFiles(SOURCES)) {
        const targets = new Set<string>();

        for (const match of readFileSync(file, 'utf8').matchAll(VALUE_IMPORT)) {
            if (match[1] !== undefined) continue;

            const target = resolveSource(file, match[2]);

            if (target !== undefined) targets.add(relative(target));
        }

        graph.set(relative(file), [...targets]);
    }

    return graph;
};

/** Groups of modules that import each other, directly or through others (Tarjan). */
const cycles = (graph: Map<string, string[]>): string[][] => {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const found: string[][] = [];
    let next = 0;
    const visit = (node: string): void => {
        index.set(node, next);
        low.set(node, next);
        next++;
        stack.push(node);
        onStack.add(node);

        for (const target of graph.get(node) ?? []) {
            if (!index.has(target)) {
                visit(target);
                low.set(node, Math.min(low.get(node) as number, low.get(target) as number));
            } else if (onStack.has(target)) {
                low.set(node, Math.min(low.get(node) as number, index.get(target) as number));
            }
        }

        if (low.get(node) !== index.get(node)) return;

        const group: string[] = [];
        let member: string;

        do {
            member = stack.pop() as string;
            onStack.delete(member);
            group.push(member);
        } while (member !== node);

        if (group.length > 1) found.push(group.sort());
    };

    for (const node of graph.keys()) if (!index.has(node)) visit(node);

    return found.sort((left, right) => left[0].localeCompare(right[0]));
};

/** The React layer and the optional entry points: nothing in the engine may load them. */
const ABOVE_THE_ENGINE = new RegExp('^(?:Interop/|Testing/|Carburetor/index\\.ts$|Carburetor/Component/(?:'
    + 'AntiHookComponent/|ScopedAntiHookComponent|bind|Scope/Carburetor(?:Context|Provider|ChildScope)\\.))');
const ENGINE = /^Carburetor\/(?:Store|Derived|Resource|Tooling|Models)\//;

describe('the library module graph', () => {
    const graph = buildGraph();

    test('covers the whole library', () => {
        expect(graph.size).toBeGreaterThan(200);
        expect(graph.get('Carburetor/Store/Carburetor.ts')).toContain('Carburetor/Store/Paths/SubscriberIndex.ts');
    });

    test('the engine layers never import the React layer, the hooks bridge or the testing helpers', () => {
        const upward: string[] = [];

        for (const [file, targets] of graph) {
            if (!ENGINE.test(file)) continue;

            for (const target of targets) {
                if (ABOVE_THE_ENGINE.test(target)) upward.push(`${file} -> ${target}`);
            }
        }

        // `Component/Connection` and `Component/Scope/CarburetorScope` are React-free and part of the
        // engine entry, so the selection code in Store may use them; they are not listed above.
        expect(upward).toEqual([]);
    });

    test('has no import cycle beyond the two known ones, both of which are safe at load time', () => {
        // Each member of these groups touches the others only inside functions, never while its own
        // module is being evaluated. A new group, or a new member, has to be checked for that.
        expect(cycles(graph)).toEqual([
            [
                'Carburetor/Component/Scope/CarburetorScope.ts',
                'Carburetor/Component/Scope/ChildCarburetorScope.ts',
            ],
            [
                'Carburetor/Store/Tracking/Aliases/NativeAliasIndex.ts',
                'Carburetor/Store/Tracking/Aliases/NativeAliasReads.ts',
                'Carburetor/Store/Tracking/Proxy/liveViews.ts',
            ],
        ]);
    });
});
