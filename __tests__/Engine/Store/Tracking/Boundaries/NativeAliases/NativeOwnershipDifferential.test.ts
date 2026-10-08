import {joinPath} from '@/Carburetor/Store/Paths/joinPath';
import {buildOwnershipIndex} from '@/Carburetor/Store/Tracking/Aliases/buildOwnershipIndex';
import {nativeAliasIndex} from '@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex';
import {RAW_TARGET} from '@/Carburetor/Store/Tracking/Models';
import {liveViews} from '@/Carburetor/Store/Tracking/Proxy/liveViews';

type TNode = Record<string, unknown>;

const comparePaths = (left: string, right: string): number => left.localeCompare(right);

/** Compare raw identities and unordered path lists, including removed objects. */
const expectFull = (root: object, removed: readonly object[] = []): Map<object, string[]> => {
    const incremental = nativeAliasIndex.paths(root);
    const full = buildOwnershipIndex(root);
    expect(incremental.size).toBe(full.size);
    for (const [value, paths] of full) {
        expect(incremental.has(value)).toBe(true);
        expect([...(incremental.get(value) ?? [])].sort(comparePaths))
            .toEqual([...paths].sort(comparePaths));
    }
    for (const value of removed) {
        expect(incremental.get(value)).toEqual(full.get(value));
    }
    return incremental;
};

/** Report an effective raw mutation with the same values available to the write traps. */
const change = (
    root: object, target: object, key: string, next: unknown, path: string, remove = false
): void => {
    const previous: unknown = Reflect.get(target, key);
    const generation = nativeAliasIndex.generation(root);
    expect(remove ? Reflect.deleteProperty(target, key) : Reflect.set(target, key, next)).toBe(true);
    nativeAliasIndex.noteChange(root, target, key, previous, remove ? undefined : next, path);
    expect(nativeAliasIndex.generation(root)).toBe(generation + 1);
};

/** Deterministic mutations without depending on a global random source. */
const seeded = (seed: number): (() => number) => {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
    };
};

describe('R39-03 incremental ownership differential contract', () => {
    test('the full builder records aliases, escaped paths and finite cycle backlinks without getters', () => {
        const child: TNode = {};
        const root: TNode = {'a.b': child, 'a~b': child};
        child.back = root;
        let getters = 0;
        Object.defineProperty(root, 'accessor', {enumerable: true, get: () => { getters++; return child; }});
        Object.defineProperty(root, 'hidden', {value: {}});
        Object.defineProperty(root, Symbol('ignored'), {value: {}, enumerable: true});
        const full = buildOwnershipIndex(root);
        expect(full.size).toBe(2);
        expect(full.get(root)).toEqual(['', 'a~1b.back', 'a~0b.back']);
        expect(full.get(child)).toEqual(['a~1b', 'a~0b']);
        expect(getters).toBe(0);
        expectFull(root);
    });

    test('visitors preserve full cycle backlinks unless they explicitly stop a branch', () => {
        const child: TNode = {};
        const root = {child};
        child.back = root;
        const full = buildOwnershipIndex(root);
        const streamed = new Map<object, string[]>();
        buildOwnershipIndex(root, '', (value, path): void => {
            const paths = streamed.get(value) ?? [];
            paths.push(path);
            streamed.set(value, paths);
        });
        expect(streamed).toEqual(full);
        const visited: object[] = [];
        buildOwnershipIndex(root, '', (value): boolean => {
            visited.push(value);
            return value !== child;
        });
        expect(visited).toEqual([root, child]);
    });

    test.each(['hatch', 'dynamic registry'])('%s: incoming nested views stop before enumeration or indexing', kind => {
        const raw = {child: {n: 1}};
        let enumerations = 0;
        let descriptors = 0;
        const view = new Proxy(raw, {
            get(target, key): unknown {
                if (kind === 'hatch' && key === RAW_TARGET) return target;
                return Reflect.get(target, key);
            },
            ownKeys(target): (string | symbol)[] {
                enumerations++;
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
                descriptors++;
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        if (kind === 'dynamic registry') liveViews.noteDynamicReadTarget(view, () => raw);
        const previous = {nested: {child: {n: 0}}};
        const root = {row: previous};
        const built = expectFull(root);
        const next = {nested: view};
        change(root, root, 'row', next, 'row');
        expect(enumerations).toBe(0);
        expect(descriptors).toBe(0);
        expect(built.has(view)).toBe(false);
        expect(built.has(next)).toBe(false);
        expect(built.get(previous)).toEqual(['row']);
        expect(next.nested).toBe(view);
        // Model the subsequent diffPaths normalization without walking the pending view.
        next.nested = raw;
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        expectFull(root, [previous]);
    });

    test.each([1, 39, 0xC0FFEE])('seed %s: set/delete row, add, push and nested arrays match a full walk after every event', seed => {
        const rows: TNode[] = [{parts: [[{n: 0}]]}, {parts: [[{n: 1}]]}];
        const root: TNode = {rows, extras: {}};
        const extras = root.extras as TNode;
        const random = seeded(seed);
        expectFull(root);
        for (let step = 0; step < 72; step++) {
            const index = random() % Math.max(rows.length, 1);
            const old = rows[index];
            switch (step % 6) {
                case 0:
                    change(root, rows, String(index), {parts: [[{n: random()}]]}, joinPath('rows', String(index)));
                    break;
                case 1:
                    change(root, rows, String(index), undefined, joinPath('rows', String(index)), true);
                    break;
                case 2:
                    change(root, extras, 'a.b~' + step, {nested: [{n: random()}]}, joinPath('extras', 'a.b~' + step));
                    break;
                case 3: {
                    const key = String(rows.length);
                    const previousLength = rows.length;
                    const next = {parts: [[{n: random()}]]};
                    const generation = nativeAliasIndex.generation(root);
                    rows.push(next);
                    nativeAliasIndex.noteChange(root, rows, key, undefined, next, joinPath('rows', key));
                    expect(nativeAliasIndex.generation(root)).toBe(generation + 1);
                    expect(rows.length).toBe(previousLength + 1);
                    break;
                }
                case 4: {
                    const rowIndex = rows.findIndex(row => row !== undefined);
                    if (rowIndex < 0) break;
                    const parts = rows[rowIndex].parts as TNode[][];
                    const key = String(parts[0].length);
                    change(root, parts[0], key, {n: random()}, joinPath('rows.' + rowIndex + '.parts.0', key));
                    break;
                }
                default:
                    change(root, extras, 'a.b~' + (step - 3), undefined, joinPath('extras', 'a.b~' + (step - 3)), true);
            }
            expectFull(root, old === undefined ? [] : [old]);
        }
    });

    test.each([7, 39, 1234])('seed %s: shared targets, alias additions/removals and cycles use safe fallback', seed => {
        const shared: TNode = {child: {n: 0}};
        const root: TNode = {left: shared, right: shared, rows: []};
        const random = seeded(seed);
        expectFull(root);
        for (let step = 0; step < 36; step++) {
            switch (step % 6) {
                case 0:
                    change(root, shared, 'child', {n: random()}, 'left.child');
                    break;
                case 1:
                    change(root, root, 'third', shared, 'third');
                    break;
                case 2:
                    change(root, shared, 'back', root, 'right.back');
                    break;
                case 3:
                    change(root, root, 'third', undefined, 'third', true);
                    break;
                case 4:
                    change(root, shared, 'back', undefined, 'left.back', true);
                    break;
                default:
                    change(root, root, 'rows', [shared, [shared]], 'rows');
            }
            expectFull(root);
        }
    });

    test('a uniquely owned subtree keeps the built map and does not reflect on unrelated containers', () => {
        const unaffected = Array.from({length: 128}, (_, n) => ({n}));
        const previous = {parts: [{n: 1}]};
        const root = {unaffected, row: previous};
        const built = expectFull(root);
        const unrelated = new Set<object>([root, unaffected, ...unaffected]);
        const descriptor = Reflect.getOwnPropertyDescriptor;
        let visits = 0;
        Reflect.getOwnPropertyDescriptor = (target, key) => {
            if (unrelated.has(target)) visits++;
            return descriptor(target, key);
        };
        try {
            change(root, root, 'row', {parts: [{n: 2}]}, 'row');
            expect(nativeAliasIndex.paths(root)).toBe(built);
            expect(visits).toBeLessThanOrEqual(1);
        } finally {
            Reflect.getOwnPropertyDescriptor = descriptor;
        }
        expectFull(root, [previous, previous.parts, previous.parts[0]]);
    });

    test('unbuilt indices stay lazy and several events before a read do not lose ownership', () => {
        const root: TNode = {row: {n: 0}};
        const descriptor = Reflect.getOwnPropertyDescriptor;
        let visits = 0;
        Reflect.getOwnPropertyDescriptor = (target, key) => {
            visits++;
            return descriptor(target, key);
        };
        try {
            change(root, root, 'row', {nested: [{}]}, 'row');
            change(root, root, 'added', {n: 1}, 'added');
            change(root, root, 'added', undefined, 'added', true);
            expect(visits).toBe(0);
        } finally {
            Reflect.getOwnPropertyDescriptor = descriptor;
        }
        expectFull(root);
    });

    test('path ambiguity, detached targets and array length truncation cannot retain stale paths', () => {
        const row = {nested: [{}]};
        const rows = [row, {nested: [{}]}, {nested: [{}]}];
        const root = {rows};
        expectFull(root);
        change(root, row, 'nested', [{}], 'wrong.nested');
        expectFull(root);
        const detached = {child: {}};
        change(root, detached, 'child', {next: {}}, 'rows.0.child');
        expectFull(root);
        const removed = rows.slice(1);
        change(root, rows, 'length', 1, 'rows.length');
        expectFull(root, removed);
    });

    test('equal previous/next means opaque exposure, not a no-op ownership proof', () => {
        const native = new Map<string, unknown>();
        const root: TNode = {native, row: {}};
        const built = expectFull(root);
        root.row = {nested: {}};
        const generation = nativeAliasIndex.generation(root);
        nativeAliasIndex.noteChange(root, root, 'native', native, native, 'native');
        expect(nativeAliasIndex.generation(root)).toBe(generation + 1);
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        expectFull(root);
    });

    test('retained old descendants, new shared nodes and cycles conservatively discard the map', () => {
        const retained = {};
        const root: TNode = {row: {retained}, sibling: {}};
        let built = expectFull(root);
        change(root, root, 'row', {retained}, 'row');
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        built = expectFull(root);
        change(root, root, 'row', {child: root.sibling}, 'row');
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        built = expectFull(root);
        const cyclic: TNode = {};
        cyclic.back = cyclic;
        change(root, root, 'row', cyclic, 'row');
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        expectFull(root);
    });

    test('the reported next must match actual own enumerable data, without invoking getters', () => {
        const root: TNode = {row: {}};
        let built = expectFull(root);
        const previous = root.row;
        root.row = {actual: {}};
        nativeAliasIndex.noteChange(root, root, 'row', previous, {reported: {}}, 'row');
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        built = expectFull(root);
        const old = root.row;
        let getters = 0;
        Object.defineProperty(root, 'row', {enumerable: true, configurable: true,
            get: () => { getters++; return old; }});
        nativeAliasIndex.noteChange(root, root, 'row', old, {}, 'row');
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        expect(getters).toBe(0);
        expectFull(root);
    });

    test('full invalidation still discards unknown graph changes and increments each event', () => {
        const root: TNode = {rows: [{n: 0}, {n: 1}]};
        const built = expectFull(root);
        const generation = nativeAliasIndex.generation(root);
        (root.rows as TNode[]).reverse();
        nativeAliasIndex.invalidate(root);
        nativeAliasIndex.invalidate(root);
        expect(nativeAliasIndex.generation(root)).toBe(generation + 2);
        expect(nativeAliasIndex.paths(root)).not.toBe(built);
        expectFull(root);
    });
});
