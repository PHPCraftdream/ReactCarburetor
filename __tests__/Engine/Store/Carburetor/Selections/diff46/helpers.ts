// Shared fixtures for the fused diff threshold tests: read-counting trees and seeded random pairs.

/** Counts every string-key read through an instrumented container. */
export interface IReadCounter {
    reads: number;
}

/**
 * Deep copy of a plain tree whose containers count their string-key reads. Shared raw objects
 * map to one shared proxy, so reference equality and array occupant identity survive the copy.
 */
export const instrument = (value: unknown, counter: IReadCounter, memo = new Map<object, object>()): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const known = memo.get(value);
    if (known) return known;
    const source = value as Record<string, unknown>;
    const copy = (Array.isArray(value)
        ? new Array<unknown>(value.length)
        : Object.create(Object.getPrototypeOf(value))) as Record<string, unknown>;
    const proxy = new Proxy(copy, {
        get: (target, key, receiver) => {
            if (typeof key === 'string') counter.reads++;
            return Reflect.get(target, key, receiver) as unknown;
        },
    });
    memo.set(value, proxy);
    for (const key of Object.keys(source)) copy[key] = instrument(source[key], counter, memo);
    return proxy;
};

/** Deep copy keeping holes, prototypes and shared references. */
export const copyTree = (value: unknown, memo = new Map<object, object>()): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const known = memo.get(value);
    if (known) return known;
    const source = value as Record<string, unknown>;
    const copy = (Array.isArray(value)
        ? new Array<unknown>(value.length)
        : Object.create(Object.getPrototypeOf(value))) as Record<string, unknown>;
    memo.set(value, copy);
    for (const key of Object.keys(source)) copy[key] = copyTree(source[key], memo);
    return copy;
};

/** `count` rows of `{title}`; the first `changed` titles differ, every row is a fresh object. */
export const rowPair = (
    count: number, changed: number
): {previous: Array<{title: number}>; next: Array<{title: number}>} => {
    const previous = Array.from({length: count}, (_, title) => ({title}));
    const next = previous.map((row, index) => ({title: index < changed ? row.title + 1 : row.title}));
    return {previous, next};
};

/** Deterministic 32-bit generator (mulberry32). */
export const seeded = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

type TRecord = Record<string, unknown>;

const makeRow = (random: () => number, id: number): TRecord => {
    const row: TRecord = {id, title: 'r' + id, meta: {x: id % 7, y: [id, id + 1]}};
    if (random() < 0.3) row.tags = ['a' + (id % 3), 'b'];
    if (random() < 0.05) row.extra = Object.assign(Object.create(null) as TRecord, {n: id});
    return row;
};

/** One mutated copy of a row, drawn from structural edits the diff walk treats differently. */
const mutateRow = (random: () => number, row: TRecord, restorable: boolean): unknown => {
    const pick = random();
    if (pick < 0.35) return {...row, title: String(row.title) + '!'};
    if (pick < 0.5) return {...row, meta: {...(row.meta as TRecord), x: -1}};
    if (pick < 0.58) return {...row, added: 1};
    if (pick < 0.66) {
        const copy = {...row};
        // A middle deletion changes key order for the inverse patch; restore then refuses it.
        delete copy[restorable ? Object.keys(copy).pop()! : 'title'];
        return copy;
    }
    if (pick < 0.72 && !restorable) {
        const {id, ...rest} = row;
        return {...rest, id};
    }
    if (pick < 0.78) return 'scalar';
    if (pick < 0.83) return [row.id];
    if (pick < 0.9) return {...row, meta: Object.assign(Object.create(null) as TRecord, row.meta as TRecord)};
    return JSON.parse(JSON.stringify(row)) as unknown;
};

const RATES = [0.02, 0.1, 0.3, 0.42, 0.48, 0.52, 0.6, 0.75, 0.9, 1];

/**
 * A previous/next pair of plain trees around the diff threshold: row arrays with moves, holes
 * and resizes, keyed maps with reorders, scalar arrays, an occasional sparse array and kind changes.
 *
 * @param seed - the generator seed.
 * @param restorable - leaves out key reorders, which restore refuses before any threshold check.
 */
export const randomPair = (seed: number, restorable = false): {previous: TRecord; next: TRecord} => {
    const random = seeded(seed);
    const rate = RATES[Math.floor(random() * RATES.length)];
    const count = 200 + Math.floor(random() * 1400);
    const rows = Array.from({length: count}, (_, id) => makeRow(random, id));
    const byId: TRecord = {};
    const width = 100 + Math.floor(random() * 2500);
    for (let index = 0; index < width; index++) byId['k' + index] = {v: index, w: 'w' + index};
    const nums = Array.from({length: 50 + Math.floor(random() * 3000)}, (_, index) => index);
    const previous: TRecord = {rows, byId, nums, misc: {a: 1, b: {c: 2}}, flag: true};
    if (random() < 0.15) {
        const sparse: unknown[] = [];
        sparse.length = 5000 + Math.floor(random() * 2000);
        for (let index = 0; index < sparse.length; index += 1 + Math.floor(random() * 9)) sparse[index] = {s: index};
        previous.sparse = sparse;
    }

    const nextRows: unknown[] = rows.map(row => {
        if (random() < rate) return mutateRow(random, row, restorable);
        return random() < 0.3 ? {...row} : row;
    });
    if (random() < 0.4) {
        const from = Math.floor(random() * nextRows.length);
        const slice = nextRows.slice(from, from + 1 + Math.floor(random() * 300));
        slice.reverse();
        nextRows.splice(from, slice.length, ...slice);
    }
    if (random() < 0.2) nextRows.splice(Math.floor(random() * nextRows.length), 1 + Math.floor(random() * 40));
    if (random() < 0.2) for (let index = 0; index < 30; index++) nextRows.push(makeRow(random, count + index));
    if (random() < 0.15) delete nextRows[Math.floor(random() * nextRows.length)];
    if (random() < 0.1) nextRows[3] = nextRows[1];

    let nextById: TRecord = {};
    for (const key of Object.keys(byId)) {
        const roll = random();
        if (roll < rate * 0.1 && !restorable) continue;
        nextById[key] = roll < rate ? {...(byId[key] as TRecord), v: -1} : byId[key];
    }
    if (random() < 0.3 && !restorable) nextById = Object.fromEntries(Object.entries(nextById).reverse());
    if (random() < 0.3) nextById.fresh = {v: 0};

    const nextNums = nums.map(value => (random() < rate ? value + 0.5 : value));
    const next: TRecord = {
        rows: nextRows, byId: nextById, nums: random() < 0.05 ? {...nextNums} : nextNums,
        misc: random() < 0.5 ? previous.misc : {a: 1, b: {c: 3}}, flag: true,
    };
    if (previous.sparse !== undefined) {
        const sparse = (previous.sparse as unknown[]).slice();
        for (let index = 0; index < sparse.length; index += 1 + Math.floor(random() * 5)) {
            if (random() < rate) sparse[index] = {s: -index};
        }
        next.sparse = sparse;
    }
    if (random() < 0.1) next.added = {z: 1};
    if (random() < 0.1 && !restorable) delete next.flag;
    return {previous, next};
};
