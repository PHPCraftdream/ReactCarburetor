import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';
import {useCarburetorValue} from '@/Interop';

interface IRow {
    id: number;
    title: string;
    tags: {a: number};
    extra?: Date | Map<string, number> | Set<number>;
    note?: string;
}

interface IData {
    items: IRow[];
    other: number;
}

class Store extends Carburetor<IData> {
    public recorded = 0;

    public override read(record: Parameters<Carburetor<IData>['read']>[0]): ReturnType<Carburetor<IData>['read']> {
        return super.read((path) => {
            this.recorded++;
            record(path);
        });
    }

    public edit = (fn: (draft: IData) => void): void => {
        this.update(fn);
    };
}

/**
 * Deterministic linear-congruential PRNG.
 *
 * @param seed - the starting seed
 * @returns a zero-argument function producing the next pseudo-random number in [0, 1)
 */
const createRng = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
};

const selectItems = (data: IData): IRow[] => data.items;

const mount = (store: Store): () => IRow[] => {
    let latest: IRow[] = [];
    const List = (): React.ReactElement => {
        const items = useCarburetorValue(store, selectItems);
        // Test instrumentation, not render state.
        // oxlint-disable-next-line react/immutability, react/globals
        latest = items;

        return <p>{items.length}</p>;
    };
    render(<List />);

    return () => latest;
};

/** Paths at which `next` is a different object than `previous`, walking plain containers. */
const changedRefs = (previous: unknown, next: unknown, path: string, into: string[]): void => {
    if (previous === next) return;
    into.push(path);
    const walkable = (value: unknown): value is Record<string, unknown> =>
        value !== null && typeof value === 'object'
        && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
    if (!walkable(previous) || !walkable(next)) return;
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        changedRefs(previous[key], next[key], `${path}.${key}`, into);
    }
};

const makeExtra = (rng: () => number): IRow['extra'] => {
    const kind = rng();
    if (kind < 0.34) return new Date(Math.floor(rng() * 5) * 1000);
    if (kind < 0.67) return new Map([['k', Math.floor(rng() * 4)]]);
    return new Set([Math.floor(rng() * 4)]);
};

describe('the write-log patch equals the full reconcile (R36-01 differential fuzz)', () => {
    test.each([1, 2, 3, 4, 5, 6])('seed %i: same snapshot and same reference changes after every write', (seed) => {
        const rng = createRng(seed * 104729);
        let nextId = 0;
        const seedRow = (): IRow => ({id: nextId++, title: 't', tags: {a: 0}});
        const initial = Array.from({length: 120}, seedRow);
        const clone = (rows: IRow[]): IRow[] => rows.map((row) => structuredClone(row));
        const patched = new Store({items: clone(initial), other: 0});
        const full = new Store({items: clone(initial), other: 0});
        Object.defineProperty(full, CARBURETOR_PATHS_SINCE, {value: undefined});
        const latestPatched = mount(patched);
        const latestFull = mount(full);
        let previousPatched = latestPatched();
        let previousFull = latestFull();

        for (let step = 0; step < 150; step++) {
            const op = rng();
            const at = Math.floor(rng() * 100);
            const value = Math.floor(rng() * 1000);
            const extraSeed = Math.floor(rng() * 1e9);
            const rowId = nextId++;
            const write = (draft: IData, source: Store): void => {
                const rows = draft.items;
                // Whole-list replacement by a clone: moving rows inside a draft would alias their members.
                const cloned = (): IRow[] => structuredClone(source.getData().items);
                if (op < 0.3) rows[at].title = `e${value}`;
                else if (op < 0.4) rows[at].tags.a = value;
                else if (op < 0.48) rows[at].tags = {a: value};
                else if (op < 0.56) rows[at] = {id: rowId, title: `n${value}`, tags: {a: value}};
                else if (op < 0.62) rows.push({id: rowId, title: 'p', tags: {a: 1}});
                else if (op < 0.67) draft.items = cloned().filter((_, index) => index !== at);
                else if (op < 0.71) draft.items = [{id: rowId, title: 'u', tags: {a: 2}}, ...cloned()];
                else if (op < 0.76) delete rows[at].note;
                else if (op < 0.81) rows[at].note = `note${value}`;
                else if (op < 0.88) rows[at].extra = makeExtra(createRng(extraSeed));
                else if (op < 0.93) {
                    const extra = rows[at].extra;
                    if (extra instanceof Map) extra.set('k', value);
                    else rows[at].title = `m${value}`;
                } else if (op < 0.97) draft.other = value;
                else rows[at].title = `${rows[at].title}`;
            };
            act(() => { patched.edit((draft) => { write(draft, patched); }); });
            act(() => { full.edit((draft) => { write(draft, full); }); });

            const nextPatched = latestPatched();
            const nextFull = latestFull();
            expect(nextPatched).toEqual(nextFull);
            expect(nextPatched).toEqual(patched.getData().items);
            const refsPatched: string[] = [];
            const refsFull: string[] = [];
            changedRefs(previousPatched, nextPatched, 'items', refsPatched);
            changedRefs(previousFull, nextFull, 'items', refsFull);
            expect(refsPatched).toEqual(refsFull);
            previousPatched = nextPatched;
            previousFull = nextFull;
        }

        // The patch really ran: it read a fraction of what the full walks read.
        expect(patched.recorded).toBeLessThan(full.recorded / 2);
    });
});
