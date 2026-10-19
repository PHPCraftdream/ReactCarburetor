import {Carburetor} from '@/Carburetor';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

interface IRow {id: number; value: {n: number};}
interface IData {rows: Array<IRow | undefined>; dictionary: Record<string, IRow>; other: number;}
type TRandom = () => number;
type TEdit = ((side: ISide, draft: IData) => void) & {structural?: boolean};

class OracleStore extends Carburetor<IData> {
    public memberReads = 0;

    /** Counts reads below the selected containers' members.
     *
     * @param record - callback receiving each path
     */
    public override read(record: Parameters<Carburetor<IData>['read']>[0]): ReturnType<Carburetor<IData>['read']> {
        return super.read((path) => {
            if (/^(rows|dictionary)\.[^.]+\./.test(path)) this.memberReads++;
            record(path);
        });
    }

    /** Runs one transaction.
     *
     * @param fn - draft mutation
     */
    public change(fn: (draft: IData) => void): void { this.update(fn); }
}

/** One side of the comparison: a store, its watches and the raw rows it removed. */
interface ISide {
    store: OracleStore;
    rows: {latest: unknown; calls: number};
    dictionary: {latest: unknown; calls: number};
    removed: IRow[];
    stop: () => void;
}

const SEEDS = 40;
const STEPS = 30;

/** Deterministic PRNG, so a failing seed replays exactly.
 *
 * @param seed - the sequence seed
 * @returns a generator of numbers in [0, 1)
 */
const mulberry32 = (seed: number): TRandom => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
};

const row = (id: number): IRow => ({id, value: {n: id % 7}});

/** Marks an edit that only restructures a selected container.
 *
 * @param edit - the edit
 * @returns the same edit, marked
 */
const structural = (edit: TEdit): TEdit => Object.assign(edit, {structural: true});

/** Steps whose batch was structural only, and those the fast side served without the full walk. */
const exercised = {structural: 0, patched: 0};

/** Opens one store with both watches; `forced` disables the write log, so every wake reconciles in full.
 *
 * @param forced - whether this side is the full-reconcile oracle
 * @returns the side
 */
const open = (forced: boolean): ISide => {
    const store = new OracleStore({
        rows: Array.from({length: 12}, (_, id) => row(id)),
        dictionary: Object.fromEntries(Array.from({length: 8}, (_, id) => ['k' + id, row(100 + id)])),
        other: 0,
    });
    if (forced) Object.defineProperty(store, CARBURETOR_PATHS_SINCE, {value: undefined});
    const side = {store, rows: {latest: undefined as unknown, calls: 0},
        dictionary: {latest: undefined as unknown, calls: 0}, removed: [] as IRow[], stop: () => undefined};
    const stopRows = store.watch((data: IData) => data.rows, (next) => { side.rows.latest = next; side.rows.calls++; });
    const stopDictionary = store.watch((data: IData) => data.dictionary, (next) => {
        side.dictionary.latest = next; side.dictionary.calls++;
    });
    side.stop = () => { stopRows(); stopDictionary(); };
    return side;
};

/** Where each member of `next` came from in `previous`: the same copy, a reused nested copy, or new.
 * A copy older than `previous` counts as new: a re-added raw row may get its earlier copy back on the
 * patched side (see structural-readd.test.ts) while the oracle copies afresh; values are still compared.
 *
 * @param previous - the earlier snapshot
 * @param next - the later snapshot
 * @returns one entry per own member
 */
const signature = (previous: unknown, next: unknown): string[] => {
    if (next === previous) return ['same'];
    const origin = new Map<unknown, string>();
    for (const [key, member] of Object.entries((previous ?? {}) as object)) {
        if (member === null || typeof member !== 'object') continue;
        origin.set(member, key);
        origin.set((member as IRow).value, key + '.value');
    }
    return Object.entries(next as object).map(([key, member]) => member !== null && typeof member === 'object'
        ? `${key}:${origin.get(member) ?? 'new'}/${origin.get((member as IRow).value) ?? 'new'}`
        : `${key}:${String(member)}`);
};

/** Draws one operation and returns it as a per-side mutation with the same parameters on both sides.
 *
 * @param random - the sequence generator
 * @param ids - next fresh row id
 * @returns the mutation for one side
 */
const draw = (random: TRandom, ids: {next: number}): TEdit => {
    const pick = random();
    const at = random();
    const id = ids.next++;
    const index = (length: number): number => Math.floor(at * length);
    const keys = (draft: IData): string[] => Object.keys(draft.dictionary);
    if (pick < 0.14) return structural((_side, draft) => { draft.rows.push(row(id)); });
    if (pick < 0.24) return structural((side, draft) => {
        const last = side.store.getData().rows[draft.rows.length - 1];
        if (last !== undefined) side.removed.push(last);
        draft.rows.pop();
    });
    if (pick < 0.30) return structural((_side, draft) => {
        draft.rows.length = Math.max(0, draft.rows.length - 1 - index(3));
    });
    if (pick < 0.36) return (_side, draft) => {
        if (draft.rows.length > 0) draft.rows[index(draft.rows.length)] = row(id);
    };
    if (pick < 0.44) return (_side, draft) => {
        const target = draft.rows[index(draft.rows.length)];
        if (target !== undefined) target.value.n++;
    };
    if (pick < 0.50) return (side, draft) => {
        if (side.removed.length === 0) return;
        const [again] = side.removed.splice(index(side.removed.length), 1);
        draft.rows.push(again);
    };
    if (pick < 0.54) return (_side, draft) => { draft.rows[draft.rows.length + 2] = row(id); };
    if (pick < 0.57) return (_side, draft) => { draft.rows.length += 2; };
    if (pick < 0.61) return (_side, draft) => { draft.rows.push(undefined); };
    if (pick < 0.65) return (side, draft) => {
        const rows = side.store.getData().rows;
        for (let hole = 0; hole < rows.length; hole++) if (!(hole in rows)) { draft.rows[hole] = row(id); return; }
    };
    if (pick < 0.67) return (_side, draft) => { draft.rows.unshift(row(id)); };
    if (pick < 0.69) return (_side, draft) => { if (draft.rows.length > 0) draft.rows.push(draft.rows[0]); };
    if (pick < 0.77) return structural((_side, draft) => { draft.dictionary['n' + id] = row(id); });
    if (pick < 0.84) return structural((_side, draft) => {
        const all = keys(draft);
        if (all.length > 0) delete draft.dictionary[all[index(all.length)]];
    });
    if (pick < 0.87) return (_side, draft) => {
        const all = keys(draft);
        if (all.length > 0) draft.dictionary[all[index(all.length)]] = row(id);
    };
    if (pick < 0.91) return structural((_side, draft) => {
        const all = keys(draft);
        if (all.length === 0) return;
        const key = all[index(all.length)];
        delete draft.dictionary[key];
        draft.dictionary[key] = row(id);
    });
    if (pick < 0.95) return (_side, draft) => {
        const all = keys(draft);
        if (all.length > 0) draft.dictionary[all[index(all.length)]].value.n++;
    };
    return (_side, draft) => { draft.other++; };
};

describe('structural patches match the full reconcile', () => {
    test.each(Array.from({length: SEEDS}, (_, seed) => seed + 1))('random sequence %i', (seed) => {
        const random = mulberry32(seed);
        const ids = {next: 1000};
        const originalError = console.error;
        const fast = open(false);
        const oracle = open(true);
        try {
            // Duplicated rows warn in development; the comparison is the point here.
            console.error = () => undefined;
            for (let step = 0; step < STEPS; step++) {
                const edits = Array.from({length: 1 + Math.floor(random() * 3)}, () => draw(random, ids));
                const before = {fast: [fast.rows.latest, fast.dictionary.latest],
                    oracle: [oracle.rows.latest, oracle.dictionary.latest]};
                const reads = {fast: fast.store.memberReads, oracle: oracle.store.memberReads};
                for (const side of [fast, oracle]) {
                    side.store.change((draft) => { for (const edit of edits) edit(side, draft); });
                }
                if (edits.every((edit) => edit.structural) && oracle.store.memberReads - reads.oracle > 0) {
                    exercised.structural++;
                    const patched = fast.store.memberReads - reads.fast < oracle.store.memberReads - reads.oracle;
                    if (patched) exercised.patched++;
                }
                const where = `seed ${seed} step ${step}`;
                expect([where, fast.rows.calls, fast.dictionary.calls])
                    .toEqual([where, oracle.rows.calls, oracle.dictionary.calls]);
                expect(fast.rows.latest ?? fast.store.getData().rows).toStrictEqual(fast.store.getData().rows);
                expect(fast.dictionary.latest ?? fast.store.getData().dictionary)
                    .toStrictEqual(fast.store.getData().dictionary);
                expect(fast.rows.latest).toStrictEqual(oracle.rows.latest);
                expect(fast.dictionary.latest).toStrictEqual(oracle.dictionary.latest);
                expect([where, signature(before.fast[0], fast.rows.latest)])
                    .toEqual([where, signature(before.oracle[0], oracle.rows.latest)]);
                expect([where, signature(before.fast[1], fast.dictionary.latest)])
                    .toEqual([where, signature(before.oracle[1], oracle.dictionary.latest)]);
            }
        } finally {
            console.error = originalError;
            fast.stop();
            oracle.stop();
        }
    });

    test('the sequences exercised the structural route', () => {
        expect(exercised.structural).toBeGreaterThan(SEEDS);
        expect(exercised.patched).toBeGreaterThan(exercised.structural / 2);
    });
});
