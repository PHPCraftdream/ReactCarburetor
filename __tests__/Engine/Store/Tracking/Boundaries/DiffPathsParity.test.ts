// R32-05: the allocation-lean diffPaths must stay semantically identical to the straightforward
// recursive reference below, on randomized table/plain pairs, for both changed sets and patches.
import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";
import {keysPath} from "@/Carburetor/Store/Paths/Markers/KeysMarker";
import {joinPath} from "@/Carburetor/Store/Paths/joinPath";
import {
    PATCH_ARRAY_LENGTH_LOCK, PATCH_KEY_ORDER_CHANGE, TPath, TPathSet, TPatchRecorder,
} from "@/Carburetor/Models/Paths";
import {keyOrderRequiresReplay} from "@/Carburetor/Store/Paths/Diff/Order/keyOrderRequiresReplay";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

type TPatch = Parameters<TPatchRecorder>[0];

type TRecord = Record<string, unknown>;

/** Deterministic order for path-set comparison (locale-independent). */
const sorted = (paths: TPath[]): TPath[] => [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** The straightforward walk: per-container key lists, a seen set, paths and segments up front. */
const reference = (
    oldValue: unknown,
    newValue: unknown,
    path: TPath,
    segments: readonly string[],
    into: TPathSet,
    patches: TPatch[]
): void => {
    if (Object.is(oldValue, newValue)) {
        return;
    }

    const trackable = (value: unknown): value is object =>
        value !== null && typeof value === 'object'
        && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype
            || Object.getPrototypeOf(value) === null);
    const sameKind = (a: object, b: object): boolean =>
        Array.isArray(a) === Array.isArray(b) && Object.getPrototypeOf(a) === Object.getPrototypeOf(b);

    if (!trackable(oldValue) || !trackable(newValue) || !sameKind(oldValue, newValue)) {
        into.add(path || WILDCARD_PATH);
        patches.push({
            segments: [...segments], previousExists: true, previous: oldValue, nextExists: true, next: newValue,
        });

        return;
    }

    const oldRecord = oldValue as TRecord;
    const newRecord = newValue as TRecord;

    if (Array.isArray(oldValue)) {
        const oldLength = Object.getOwnPropertyDescriptor(oldValue, 'length')!;
        const newLength = Object.getOwnPropertyDescriptor(newValue, 'length')!;
        if (oldLength.value !== newLength.value) {
            into.add(joinPath(path, 'length'));
            patches.push({
                segments: [...segments, 'length'], previousExists: true,
                previous: oldLength.value, nextExists: true, next: newLength.value,
            });
        }
        if (oldLength.writable !== newLength.writable) {
            patches.push(PATCH_ARRAY_LENGTH_LOCK);
        }
    }

    const oldKeys = Object.keys(oldRecord);
    const newKeys = Object.keys(newRecord);
    let keysChanged = oldKeys.length !== newKeys.length;
    if (!keysChanged) {
        for (let index = 0; index < oldKeys.length; index++) {
            if (oldKeys[index] !== newKeys[index]) {
                keysChanged = true;

                break;
            }
        }
    }
    if (keysChanged && !Array.isArray(oldValue) && keyOrderRequiresReplay(oldKeys, newKeys)) {
        patches.push(PATCH_KEY_ORDER_CHANGE);
    }

    const seen = new Set<string>();

    for (const key of oldKeys) {
        seen.add(key);

        if (!Object.prototype.hasOwnProperty.call(newRecord, key)) {
            into.add(joinPath(path, key));
            patches.push({
                segments: [...segments, key], previousExists: true,
                previous: oldRecord[key], nextExists: false, next: undefined,
            });

            continue;
        }

        reference(oldRecord[key], newRecord[key], joinPath(path, key), [...segments, key], into, patches);
    }

    for (const key of newKeys) {
        if (seen.has(key)) {
            continue;
        }

        into.add(joinPath(path, key));
        patches.push({
            segments: [...segments, key], previousExists: false,
            previous: undefined, nextExists: true, next: newRecord[key],
        });
    }

    if (keysChanged) {
        into.add(keysPath(path));
    }
};

/** Depth-limited random plain data: objects, dense and sparse arrays, scalar leaves. */
const generate = (random: () => number, depth: number): unknown => {
    const kind = depth <= 0 || random() < 0.4
        ? random() < 0.15 ? 'sparse' : 'leaf'
        : random() < 0.5 ? 'object' : 'array';

    if (kind === 'leaf') {
        const pick = random();
        if (pick < 0.2) return random();
        if (pick < 0.4) return Math.floor(random() * 4);
        if (pick < 0.6) return 's' + Math.floor(random() * 3);
        if (pick < 0.8) return true;

        return pick < 0.9 ? null : undefined;
    }

    if (kind === 'object') {
        const result: TRecord = {};
        const count = 1 + Math.floor(random() * 4);
        for (let index = 0; index < count; index++) {
            result['k' + Math.floor(random() * 5)] = generate(random, depth - 1);
        }

        return result;
    }

    const length = Math.floor(random() * 5);
    if (kind === 'sparse') {
        const result: unknown[] = Array.from({length});

        return result;
    }

    return Array.from({length}, () => generate(random, depth - 1));
};

/** Mutates a copy: key additions, deletions, reorder and value swaps. */
const mutate = (value: unknown, random: () => number, depth: number): unknown => {
    if (value === null || typeof value !== 'object') {
        return random() < 0.5 ? value : generate(random, 0);
    }

    if (Array.isArray(value)) {
        let array = value.map(entry => mutate(entry, random, depth - 1));
        if (random() < 0.2) array = array.slice(1);
        if (random() < 0.2) array = [...array, generate(random, 0)];
        if (random() < 0.15 && array.length > 1) array = array.slice().reverse();

        return array;
    }

    const record: TRecord = {};
    const keys = Object.keys(value as TRecord);
    const source = random() < 0.2 ? keys.slice().reverse() : keys;
    for (const key of source) {
        if (random() < 0.15) {
            continue;
        }
        record[key] = mutate((value as TRecord)[key], random, depth - 1);
    }
    if (random() < 0.3) {
        record['new' + Math.floor(random() * 3)] = generate(random, depth - 1);
    }

    return record;
};

describe('R32-05 — diffPaths matches the reference walk', () => {
    it('agrees on changed sets and patches across randomized pairs', () => {
        let seed = 0x2f6e2b1;
        const random = (): number => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;

            return seed / 0x7fffffff;
        };

        for (let round = 0; round < 400; round++) {
            const previous = generate(random, 3);
            const next = mutate(previous, random, 3);

            const changed = diffPaths(previous, next);
            const patches: TPatch[] = [];
            diffPaths(previous, next, '', [], patches);

            const expected = new Set<TPath>();
            const expectedPatches: TPatch[] = [];
            reference(previous, next, '', [], expected, expectedPatches);

            expect(sorted([...changed])).toEqual(sorted([...expected]));
            expect(patches).toEqual(expectedPatches);
        }
    });

    it('agrees on a wide table with one changed row', () => {
        const rows = Array.from({length: 200}, (_, index) => ({id: index, title: 't' + index, done: false}));
        const nextRows = rows.map(row => row.id === 137 ? {...row, done: true} : row);

        const changed = diffPaths({rows}, {rows: nextRows});
        const patches: TPatch[] = [];
        diffPaths({rows}, {rows: nextRows}, '', [], patches);

        const expected = new Set<TPath>();
        const expectedPatches: TPatch[] = [];
        reference({rows}, {rows: nextRows}, '', [], expected, expectedPatches);

        expect(sorted([...changed])).toEqual(sorted([...expected]));
        expect(patches).toEqual(expectedPatches);
        expect(sorted([...changed])).toContain('rows.137.done');
    });
});
