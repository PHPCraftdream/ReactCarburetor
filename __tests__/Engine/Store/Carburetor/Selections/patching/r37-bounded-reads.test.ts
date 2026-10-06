import {Carburetor} from '@/Carburetor';

interface IPayload {
    [key: string]: number;
}

interface IRow {
    payload: number | IPayload;
}

interface IData {
    rows: IRow[];
    other: number;
}

type TSubscribeArgs = Parameters<Carburetor<IData>['subscribe']>;

/** Records the largest read set any (re-)subscription of the store has filed. */
class FilingCarburetor extends Carburetor<IData> {
    public maxFiled = 0;

    public edit = (fn: (draft: IData) => void): void => {
        this.update(fn);
    };

    public override subscribe(
        callback: TSubscribeArgs[0], options?: TSubscribeArgs[1]
    ): string {
        const size = options?.reads?.size ?? 0;
        if (size > this.maxFiled) this.maxFiled = size;
        return super.subscribe(callback, options);
    }
}

interface IObserved {
    payload: number | IPayload;
    wakes: number;
}

/** Runs payload object→primitive cycles under a `d => d.rows` watch and records what was delivered. */
const runCycles = (
    store: FilingCarburetor, cycles: number, observe?: (observed: IObserved) => void
): number => {
    let wakes = 0;
    const stop = store.watch((data: IData) => data.rows, (next) => {
        wakes++;
        observe?.({payload: next[0].payload, wakes});
    });
    for (let cycle = 0; cycle < cycles; cycle++) {
        const payload: IPayload = {};
        for (let field = 0; field < 16; field++) payload[`c${cycle}f${field}`] = field;
        store.edit((draft) => { draft.rows[0].payload = payload; });
        store.edit((draft) => { draft.rows[0].payload = 0; });
    }
    stop();
    return wakes;
};

describe('the filed read set stays bounded across schema-history cycles (R37-03)', () => {
    test('16 object→primitive replacement cycles file a constant read set and deliver every replacement', () => {
        const store = new FilingCarburetor({rows: [{payload: 0}], other: 0});
        const payloads: Array<number | IPayload> = [];

        const wakes = runCycles(store, 16, ({payload}) => { payloads.push(payload); });

        // Every replacement is observed, in order, with exact content.
        expect(wakes).toBe(32);
        expect(payloads).toHaveLength(32);
        for (let cycle = 0; cycle < 16; cycle++) {
            const objectPhase = payloads[cycle * 2] as IPayload;
            expect(typeof objectPhase).toBe('object');
            expect(Object.keys(objectPhase)).toHaveLength(16);
            expect(objectPhase[`c${cycle}f0`]).toBe(0);
            expect(objectPhase[`c${cycle}f15`]).toBe(15);
            expect(payloads[cycle * 2 + 1]).toBe(0);
        }
        // The reported growth filed 263 paths here; a replaced subtree must not accumulate.
        expect(store.maxFiled).toBeLessThan(50);
    });

    test('64 cycles file the same bounded set', () => {
        const store = new FilingCarburetor({rows: [{payload: 0}], other: 0});

        const wakes = runCycles(store, 64);

        expect(wakes).toBe(128);
        // The reported growth filed 1031 paths here.
        expect(store.maxFiled).toBeLessThan(50);
    });

    test('reads outside the replaced subtree keep delivering', () => {
        const store = new FilingCarburetor({rows: [{payload: 0}], other: 0});
        const seen: Array<{payload: number | IPayload; other: number}> = [];
        const stop = store.watch(
            (data: IData) => ({rows: data.rows, other: data.other}),
            (next) => { seen.push({payload: next.rows[0].payload, other: next.other}); }
        );

        for (let cycle = 0; cycle < 4; cycle++) {
            store.edit((draft) => { draft.rows[0].payload = {pick: cycle}; });
            store.edit((draft) => { draft.other = cycle + 1; });
            store.edit((draft) => { draft.rows[0].payload = 0; });
        }
        // A child key the set never held before still wakes the observer.
        store.edit((draft) => { draft.rows[0].payload = {brandNew: 1}; });

        stop();

        expect(seen).toHaveLength(13);
        for (let cycle = 0; cycle < 4; cycle++) {
            expect(seen[cycle * 3]).toEqual({payload: {pick: cycle}, other: cycle});
            expect(seen[cycle * 3 + 1]).toEqual({payload: {pick: cycle}, other: cycle + 1});
            expect(seen[cycle * 3 + 2]).toEqual({payload: 0, other: cycle + 1});
        }
        expect(seen[12]).toEqual({payload: {brandNew: 1}, other: 4});
        expect(store.maxFiled).toBeLessThan(50);
    });

    test('a true conditional keeps delivering across parity flips with a bounded read set', () => {
        const store = new FilingCarburetor({rows: [{payload: 0}], other: 0});
        const seen: Array<{branch: 'rows' | 'payload'; payload: number | IPayload}> = [];
        const stop = store.watch(
            (data: IData) => (data.other % 2 === 0 ? data.rows : data.rows[0].payload),
            (next) => {
                seen.push(Array.isArray(next)
                    ? {branch: 'rows', payload: next[0].payload}
                    : {branch: 'payload', payload: next});
            }
        );

        for (let cycle = 0; cycle < 2; cycle++) {
            // Even parity: the selection is the whole rows list.
            store.edit((draft) => { draft.rows[0].payload = {pick: cycle}; });
            // The parity flip re-files the read set on the scalar branch, same content.
            store.edit((draft) => { draft.other = cycle * 2 + 1; });
            store.edit((draft) => { draft.rows[0].payload = 0; });
            store.edit((draft) => { draft.other = (cycle + 1) * 2; });
        }
        // A brand-new child key written into the payload after a replacement still wakes.
        store.edit((draft) => { draft.rows[0].payload = {brandNew: 1}; });
        store.edit((draft) => { (draft.rows[0].payload as IPayload).brandNew = 2; });

        stop();

        expect(seen).toEqual([
            {branch: 'rows', payload: {pick: 0}},
            {branch: 'payload', payload: {pick: 0}},
            {branch: 'payload', payload: 0},
            {branch: 'rows', payload: 0},
            {branch: 'rows', payload: {pick: 1}},
            {branch: 'payload', payload: {pick: 1}},
            {branch: 'payload', payload: 0},
            {branch: 'rows', payload: 0},
            {branch: 'rows', payload: {brandNew: 1}},
            {branch: 'rows', payload: {brandNew: 2}},
        ]);
        expect(store.maxFiled).toBeLessThan(50);
    });

    test('control: the counter sees a genuinely growing shape', () => {
        const store = new FilingCarburetor({rows: [{payload: 0 as number | IPayload}], other: 0});
        let wakes = 0;
        const stop = store.watch((data: IData) => data.rows, () => { wakes++; });

        let payload: IPayload = {};
        for (let cycle = 0; cycle < 24; cycle++) {
            payload = {...payload, [`k${cycle}`]: cycle};
            const fresh = payload;
            store.edit((draft) => { draft.rows[0].payload = fresh; });
        }

        stop();

        expect(wakes).toBe(24);
        expect(store.maxFiled).toBeGreaterThan(25);
    });
});
