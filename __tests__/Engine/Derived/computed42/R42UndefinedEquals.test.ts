import {Carburetor, computed, ICarburetorSubscription, transaction} from '@/Carburetor';
import {CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';
import {C} from '@/Carburetor/Derived/Models';

type Nullish = undefined | null;

const snapshotVersion = (source: ICarburetorSubscription): number =>
    (source as IInternalSubscriptionProtocol)[CARBURETOR_SNAPSHOT_VERSION]!();

describe('R42 successful undefined equality baseline', () => {
    test.each([false, true])('both nullish directions retain their baseline, observed=%s', observed => {
        for (const start of [false, true]) {
            const store = new Carburetor({present: start});
            const comparisons: [Nullish, Nullish][] = [];
            const value = computed(read => read(store).present ? null : undefined, {
                equals: (before, after) => {
                    comparisons.push([before, after]);
                    return before == null && after == null;
                },
            });
            const seen: Nullish[] = [];
            const id = observed ? value.subscribe(() => seen.push(value.get())) : undefined;
            try {
                const baseline = start ? null : undefined;
                expect(value.get()).toBe(baseline);
                expect(comparisons).toEqual([]);
                store.update(draft => { draft.present = !start; });
                expect(value.get()).toBe(baseline);
                expect(value.get()).toBe(baseline);
                expect(comparisons).toEqual([[baseline, start ? undefined : null]]);
                expect(value.getVersion()).toBe(0);
                expect(snapshotVersion(value)).toBe(0);
                expect(seen).toEqual([]);
                store.update(draft => { draft.present = start; });
                expect(value.get()).toBe(baseline);
                expect(comparisons).toHaveLength(1);
                expect(value.getVersion()).toBe(0);
                expect(snapshotVersion(value)).toBe(0);
                expect(seen).toEqual([]);
            } finally {
                if (id !== undefined) value.unsubscribe(id);
            }
        }
    });

    test.each([undefined, null])('a failed cold evaluation creates no equality baseline for %s', result => {
        const store = new Carburetor({tick: 0});
        const failure = new Error('cold body');
        let poison = true;
        let comparisons = 0;
        const value = computed(read => {
            void read(store).tick;
            if (poison) throw failure;
            return result;
        }, {equals: () => { comparisons++; return true; }});
        expect(() => value.get()).toThrow('cold body');
        expect(comparisons).toBe(0);
        poison = false;
        expect(value.get()).toBe(result);
        expect(comparisons).toBe(0);
        expect(value.getVersion()).toBe(0);
        expect(snapshotVersion(value)).toBe(0);
        const id = value.subscribe(() => {});
        try {
            expect(value.get()).toBe(result);
            expect(comparisons).toBe(0);
        } finally {
            value.unsubscribe(id);
        }
    });

    test.each([false, true])('false comparator accepts undefined to null, observed=%s', observed => {
        const store = new Carburetor({present: false});
        const comparisons: [Nullish, Nullish][] = [];
        const value = computed(read => read(store).present ? null : undefined, {
            equals: (before, after) => { comparisons.push([before, after]); return false; },
        });
        const seen: Nullish[] = [];
        const id = observed ? value.subscribe(() => seen.push(value.get())) : undefined;
        try {
            expect(value.get()).toBeUndefined();
            expect(comparisons).toEqual([]);
            store.update(draft => { draft.present = true; });
            expect(value.get()).toBeNull();
            expect(comparisons).toEqual([[undefined, null]]);
            expect(seen).toEqual(observed ? [null] : []);
            expect(value.getVersion()).toBe(observed ? 1 : 0);
            expect(snapshotVersion(value)).toBe(1);
        } finally {
            if (id !== undefined) value.unsubscribe(id);
        }
    });

    test('eager observed cache does not replace the successful undefined announcement baseline', () => {
        const store = new Carburetor({present: false});
        const comparisons: [Nullish, Nullish][] = [];
        const value = computed(read => read(store).present ? null : undefined, {
            equals: (before, after) => { comparisons.push([before, after]); return true; },
        });
        const seen: Nullish[] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        const baseline = value[C.announced];
        try {
            transaction(() => {
                store.update(draft => { draft.present = true; });
                expect(value.get()).toBeNull();
                expect(value[C.announced]).toBe(baseline);
                expect(value[C.announced]!.value).toBeUndefined();
                expect(comparisons).toEqual([]);
                expect(seen).toEqual([]);
            });
            expect(value.get()).toBeUndefined();
            expect(value[C.announced]).toBe(baseline);
            expect(comparisons).toEqual([[undefined, null]]);
            expect(value.getVersion()).toBe(0);
            expect(snapshotVersion(value)).toBe(0);
            expect(seen).toEqual([]);
        } finally {
            value.unsubscribe(id);
        }
    });

    test.each([false, true])('equal nullish result migrates dependencies, observed=%s', observed => {
        const flag = new Carburetor({right: false});
        const left = new Carburetor<{value: Nullish | number}>({value: undefined});
        const right = new Carburetor<{value: Nullish | number}>({value: null});
        const comparisons: [Nullish | number, Nullish | number][] = [];
        let runs = 0;
        const value = computed(read => {
            runs++;
            return read(read(flag).right ? right : left).value;
        }, {
            equals: (before, after) => {
                comparisons.push([before, after]);
                return before == null && after == null;
            },
        });
        const seen: (Nullish | number)[] = [];
        const id = observed ? value.subscribe(() => seen.push(value.get())) : undefined;
        try {
            expect(value.get()).toBeUndefined();
            flag.update(draft => { draft.right = true; });
            expect(value.get()).toBeUndefined();
            expect(comparisons).toEqual([[undefined, null]]);
            expect(runs).toBe(2);
            expect(snapshotVersion(value)).toBe(0);
            left.update(draft => { draft.value = 9; });
            expect(value.get()).toBeUndefined();
            expect(runs).toBe(2);
            right.update(draft => { draft.value = 7; });
            expect(value.get()).toBe(7);
            expect(comparisons).toEqual([[undefined, null], [undefined, 7]]);
            expect(runs).toBe(3);
            expect(seen).toEqual(observed ? [7] : []);
            expect(value.getVersion()).toBe(observed ? 1 : 0);
            expect(snapshotVersion(value)).toBe(1);
        } finally {
            if (id !== undefined) value.unsubscribe(id);
        }
    });

    test('a comparator throw during settlement preserves announcement and independent delivery', () => {
        const store = new Carburetor({present: false, tick: 0});
        const failure = new Error('undefined comparison');
        let poison = true;
        const comparisons: [Nullish, Nullish][] = [];
        const value = computed(read => {
            const state = read(store);
            void state.tick;
            return state.present ? null : undefined;
        }, {
            equals: (before, after) => {
                comparisons.push([before, after]);
                if (poison) throw failure;
                return true;
            },
        });
        const healthy = computed(read => read(store).present);
        const seen: Nullish[] = [];
        const independent: boolean[] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        const healthyId = healthy.subscribe(() => independent.push(healthy.get()));
        const baseline = value[C.announced];
        const originalError = console.error;
        const report = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            if (!args.some(value => typeof value === 'string' && value.includes(failure.message))) {
                originalError(...args);
            }
        });
        try {
            store.update(draft => { draft.present = true; });
            expect(comparisons).toEqual([[undefined, null]]);
            expect(value[C.announced]).toBe(baseline);
            expect(value.getVersion()).toBe(0);
            expect(seen).toEqual([]);
            expect(independent).toEqual([true]);
            poison = false;
            store.update(draft => { draft.tick++; });
            expect(value.get()).toBeUndefined();
            expect(comparisons).toEqual([[undefined, null], [undefined, null]]);
            expect(value[C.announced]).toBe(baseline);
            expect(value.getVersion()).toBe(0);
            expect(seen).toEqual([]);
        } finally {
            report.mockRestore();
            value.unsubscribe(id);
            healthy.unsubscribe(healthyId);
        }
    });

    test('unobserved comparator errors reach the reader without advancing snapshot revision', () => {
        const store = new Carburetor({present: false});
        const failure = new Error('unobserved comparison');
        const comparisons: [Nullish, Nullish][] = [];
        const value = computed(read => read(store).present ? null : undefined, {
            equals: (before, after) => { comparisons.push([before, after]); throw failure; },
        });
        expect(value.get()).toBeUndefined();
        store.update(draft => { draft.present = true; });
        let caught: unknown;
        try { value.get(); } catch (error: unknown) { caught = error; }
        expect(caught).toBe(failure);
        expect(comparisons).toEqual([[undefined, null]]);
        expect(value.getVersion()).toBe(0);
        expect(snapshotVersion(value)).toBe(0);
    });

    test.each([false, true])('stable live identity still moves its revision, observed=%s', observed => {
        const store = new Carburetor({box: {n: 1}});
        let comparisons = 0;
        const value = computed(read => {
            const box = read(store).box;
            void box.n;
            return box;
        }, {equals: () => { comparisons++; return true; }});
        let deliveries = 0;
        const id = observed ? value.subscribe(() => { deliveries++; }) : undefined;
        try {
            const baseline = value.get();
            store.update(draft => { draft.box.n = 2; });
            expect(value.get()).toBe(baseline);
            expect(value.get().n).toBe(2);
            expect(comparisons).toBe(0);
            expect(deliveries).toBe(observed ? 1 : 0);
            expect(value.getVersion()).toBe(observed ? 1 : 0);
            expect(snapshotVersion(value)).toBe(1);
        } finally {
            if (id !== undefined) value.unsubscribe(id);
        }
    });

    test.each([false, true])('stable exotic envelope still moves its revision, observed=%s', observed => {
        const store = new Carburetor({tick: 0});
        const index = new Map([['n', 1]]);
        const envelope = {index};
        let comparisons = 0;
        const value = computed(read => {
            void read(store).tick;
            return envelope;
        }, {equals: () => { comparisons++; return true; }});
        let deliveries = 0;
        const id = observed ? value.subscribe(() => { deliveries++; }) : undefined;
        try {
            expect(value.get()).toBe(envelope);
            index.set('n', 2);
            store.update(draft => { draft.tick++; });
            expect(value.get()).toBe(envelope);
            expect(value.get().index.get('n')).toBe(2);
            expect(comparisons).toBe(0);
            expect(deliveries).toBe(observed ? 1 : 0);
            expect(value.getVersion()).toBe(observed ? 1 : 0);
            expect(snapshotVersion(value)).toBe(1);
        } finally {
            if (id !== undefined) value.unsubscribe(id);
        }
    });

    test.each([false, true])(
        'Object.is short circuits undefined and NaN, but not signed zero, observed=%s', observed => {
        const store = new Carburetor({step: 0});
        const outputs = [undefined, undefined, NaN, NaN, 0, -0];
        const comparisons: [number | undefined, number | undefined][] = [];
        const value = computed(read => outputs[read(store).step], {
            equals: (before, after) => { comparisons.push([before, after]); return false; },
        });
        const seen: (number | undefined)[] = [];
        const id = observed ? value.subscribe(() => seen.push(value.get())) : undefined;
        try {
            expect(value.get()).toBeUndefined();
            for (let step = 1; step < outputs.length; step++) {
                store.update(draft => { draft.step = step; });
                expect(Object.is(value.get(), outputs[step])).toBe(true);
            }
            expect(comparisons).toEqual([[undefined, NaN], [NaN, 0], [0, -0]]);
            expect(seen).toEqual(observed ? [NaN, 0, -0] : []);
            expect(value.getVersion()).toBe(observed ? 3 : 0);
            expect(snapshotVersion(value)).toBe(3);
        } finally {
            if (id !== undefined) value.unsubscribe(id);
        }
    });
});
