import {Carburetor, computed, ICarburetorSubscription, IComputed, transaction} from '@/Carburetor';
import {CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';

const token = (source: ICarburetorSubscription): number =>
    (source as IInternalSubscriptionProtocol)[CARBURETOR_SNAPSHOT_VERSION]!();

const expectFailure = (read: () => unknown, failure: Error): void => {
    let caught: unknown;
    try { read(); } catch (error: unknown) { caught = error; }
    expect(caught).toBe(failure);
};

type Result = number | number[] | undefined;
const lanes: {name: string; result: (n: number) => Result}[] = [
    {name: 'array', result: n => [n]},
    {name: 'scalar', result: n => n},
    {name: 'undefined baseline', result: n => n === 1 ? undefined : n},
];

describe('R43-C01 unobserved equality acceptance', () => {
    for (const lane of lanes) {
        test.each([true, false])(`${lane.name}: repeated failure and recovery equals=%s`, equal => {
            const store = new Carburetor({n: 1});
            const failure = new Error('R43 comparator');
            const bodyFailure = new Error('R43 intervening body');
            let poison = true;
            let poisonBody = false;
            const comparisons: [Result, Result][] = [];
            const value = computed(read => {
                const n = read(store).n;
                if (poisonBody) throw bodyFailure;
                return lane.result(n);
            }, {
                equals: (before, after) => {
                    comparisons.push([before, after]);
                    if (poison) throw failure;
                    return equal;
                },
            });
            const baseline = value.get();
            expect(comparisons).toEqual([]);
            store.update(draft => { draft.n = 2; });
            for (let attempt = 0; attempt < 2; attempt++) {
                expectFailure(() => value.get(), failure);
                expect(value.getVersion()).toBe(0);
                expect(token(value)).toBe(0);
            }
            expect(comparisons).toHaveLength(2);
            for (const [before, after] of comparisons) {
                expect(before).toBe(baseline);
                expect(after).toEqual(lane.result(2));
            }
            poisonBody = true;
            expectFailure(() => value.get(), bodyFailure);
            expectFailure(() => value.get(), bodyFailure);
            expect(comparisons).toHaveLength(2);
            expect(token(value)).toBe(0);
            poisonBody = false;
            poison = false;
            const accepted = value.get();
            expect(comparisons).toHaveLength(3);
            expect(comparisons[2][0]).toBe(baseline);
            expect(comparisons[2][1]).toEqual(lane.result(2));
            if (equal) {
                expect(accepted).toBe(baseline);
            } else {
                expect(accepted).not.toBe(baseline);
                expect(accepted).toBe(comparisons[2][1]);
            }
            expect(value.get()).toBe(accepted);
            expect(value.get()).toBe(accepted);
            expect(comparisons).toHaveLength(3);
            expect(value.getVersion()).toBe(0);
            expect(token(value)).toBe(equal ? 0 : 1);
        });
    }

    test.each([true, false])('array content-equal candidate is not accepted before verdict=%s', equal => {
        const store = new Carburetor({n: 1});
        const failure = new Error('same content comparator');
        let poison = true;
        const comparisons: [number[], number[]][] = [];
        const value = computed(read => [read(store).n % 2], {
            equals: (before, after) => {
                comparisons.push([before, after]);
                if (poison) throw failure;
                return equal;
            },
        });
        const baseline = value.get();
        store.update(draft => { draft.n = 3; });
        expectFailure(() => value.get(), failure);
        expectFailure(() => value.get(), failure);
        poison = false;
        const accepted = value.get();
        expect(comparisons).toHaveLength(3);
        for (const [before, after] of comparisons) {
            expect(before).toBe(baseline);
            expect(after).not.toBe(baseline);
            expect(after).toEqual([1]);
        }
        expect(accepted).toBe(equal ? baseline : comparisons[2][1]);
        expect(token(value)).toBe(equal ? 0 : 1);
        expect(value.get()).toBe(accepted);
        expect(comparisons).toHaveLength(3);
    });

    test('failed branch migration retries the original baseline and retires recorder routes on success', () => {
        const flag = new Carburetor({right: false});
        const left = new Carburetor({n: 1});
        const right = new Carburetor({n: 2});
        const failure = new Error('migration comparator');
        let poison = true;
        let runs = 0;
        const comparisons: [number[], number[]][] = [];
        const value = computed(read => {
            runs++;
            return [read(read(flag).right ? right : left).n];
        }, {
            equals: (before, after) => {
                comparisons.push([before, after]);
                if (poison) throw failure;
                return after[0] === 2;
            },
        });
        const baseline = value.get();
        flag.update(draft => { draft.right = true; });
        expectFailure(() => value.get(), failure);
        right.update(draft => { draft.n = 3; });
        expectFailure(() => value.get(), failure);
        right.update(draft => { draft.n = 2; });
        poison = false;
        expect(value.get()).toBe(baseline);
        expect(comparisons.map(pair => pair[1])).toEqual([[2], [3], [2]]);
        expect(comparisons.every(pair => pair[0] === baseline)).toBe(true);
        expect(token(value)).toBe(0);
        const settledRuns = runs;
        left.update(draft => { draft.n = 9; });
        expect(value.get()).toBe(baseline);
        expect(runs).toBe(settledRuns);
        right.update(draft => { draft.n = 4; });
        const changed = value.get();
        expect(changed).toEqual([4]);
        expect(changed).not.toBe(baseline);
        expect(token(value)).toBe(1);
        expect(value.getVersion()).toBe(0);
    });

    for (const writeDuringSelfRead of [false, true]) {
        test.each([true, false])(
            `reentrant failure restores the public baseline, source-write=${writeDuringSelfRead}, recovery=%s`,
            equal => {
                const store = new Carburetor({n: 1, noise: 0});
                const failure = new Error('outer self-read comparator');
                let poison = true;
                let inside = false;
                let runs = 0;
                const outerComparisons: [number[], number[]][] = [];
                const nestedValues: number[][] = [];
                const nestedTokens: number[] = [];
                const compare = (before: number[], after: number[]): boolean => {
                    if (inside) return false;
                    outerComparisons.push([before, after]);
                    if (!poison) return equal;
                    inside = true;
                    try {
                        if (writeDuringSelfRead) store.update(draft => { draft.n++; });
                        nestedValues.push(value.get());
                        nestedTokens.push(token(value));
                    } finally {
                        inside = false;
                    }
                    throw failure;
                };
                const value: IComputed<number[]> = computed(read => {
                    runs++;
                    return [read(store).n];
                }, {equals: compare});
                const seen: number[][] = [];
                const id = value.subscribe(() => seen.push(value.get()));
                const baseline = value.get();
                value.unsubscribe(id);
                expect(outerComparisons).toEqual([]);
                store.update(draft => { draft.n = 2; });
                for (let attempt = 0; attempt < 2; attempt++) {
                    expectFailure(() => value.get(), failure);
                    expect(outerComparisons).toHaveLength(attempt + 1);
                    expect(outerComparisons[attempt][0]).toBe(baseline);
                    expect(outerComparisons[attempt][1]).toEqual([2 + (writeDuringSelfRead ? attempt : 0)]);
                    expect(nestedValues[attempt]).toEqual([2 + (writeDuringSelfRead ? attempt + 1 : 0)]);
                    expect(nestedValues[attempt]).not.toBe(baseline);
                    expect(nestedTokens[attempt]).toBe(writeDuringSelfRead ? 1 : 0);
                    expect(token(value)).toBe(0);
                    expect(value.getVersion()).toBe(0);
                    expect(seen).toEqual([]);
                }
                poison = false;
                const accepted = value.get();
                expect(outerComparisons).toHaveLength(3);
                expect(outerComparisons[2][0]).toBe(baseline);
                expect(outerComparisons[2][1]).toEqual([writeDuringSelfRead ? 4 : 2]);
                expect(accepted).toBe(equal ? baseline : outerComparisons[2][1]);
                expect(token(value)).toBe(equal ? 0 : 1);
                expect(value.getVersion()).toBe(0);
                const acceptedRuns = runs;
                store.update(draft => { draft.noise++; });
                expect(value.get()).toBe(accepted);
                expect(runs).toBe(acceptedRuns);
                expect(outerComparisons).toHaveLength(3);
                store.update(draft => { draft.n = 5; });
                expect(value.get()).toBe(equal ? baseline : outerComparisons[3][1]);
                expect(outerComparisons[3][0]).toBe(accepted);
                expect(outerComparisons[3][1]).toEqual([5]);
                expect(token(value)).toBe(equal ? 0 : 2);
                expect(seen).toEqual([]);
            }
        );
    }

    test('successful self-read with a source write does not stamp the outer candidate fresh', () => {
        const store = new Carburetor({n: 1});
        let reenter = true;
        let inside = false;
        const comparisons: [number[], number[]][] = [];
        const compare = (before: number[], after: number[]): boolean => {
            if (inside) return false;
            comparisons.push([before, after]);
            if (reenter) {
                reenter = false;
                inside = true;
                try {
                    store.update(draft => { draft.n = 3; });
                    expect(value.get()).toEqual([3]);
                    expect(token(value)).toBe(1);
                } finally {
                    inside = false;
                }
            }
            return false;
        };
        const value: IComputed<number[]> = computed(read => [read(store).n], {equals: compare});
        const baseline = value.get();
        store.update(draft => { draft.n = 2; });
        const first = value.get();
        expect(first).toEqual([2]);
        expect(comparisons[0][0]).toBe(baseline);
        expect(comparisons[0][1]).toBe(first);
        expect(token(value)).toBe(1);
        const current = value.get();
        expect(current).toEqual([3]);
        expect(comparisons).toHaveLength(2);
        expect(comparisons[1][0]).toBe(first);
        expect(comparisons[1][1]).toBe(current);
        expect(token(value)).toBe(2);
        expect(value.getVersion()).toBe(0);
        expect(value.get()).toBe(current);
        expect(comparisons).toHaveLength(2);
    });

    test('empty cold cache has no comparator decision to retry', () => {
        let comparisons = 0;
        const value = computed(() => undefined, {
            equals: () => { comparisons++; throw new Error('must not compare'); },
        });
        expect(value.get()).toBeUndefined();
        expect(value.get()).toBeUndefined();
        const id = value.subscribe(() => {});
        try {
            expect(value.get()).toBeUndefined();
            expect(comparisons).toBe(0);
            expect(token(value)).toBe(0);
        } finally {
            value.unsubscribe(id);
        }
    });

    test.each([true, false])('observed eager reads keep settlement separate, equals=%s', equal => {
        const store = new Carburetor({n: 1});
        const comparisons: [number[], number[]][] = [];
        const value = computed(read => [read(store).n], {
            equals: (before, after) => { comparisons.push([before, after]); return equal; },
        });
        const seen: number[][] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        const baseline = value.get();
        try {
            transaction(() => {
                store.update(draft => { draft.n = 2; });
                expect(value.get()).toEqual([2]);
                expect(value.getVersion()).toBe(0);
                expect(comparisons).toEqual([]);
                expect(seen).toEqual([]);
                expect(token(value)).toBe(0);
            });
            expect(comparisons).toHaveLength(1);
            expect(comparisons[0][0]).toBe(baseline);
            expect(value.get()).toBe(equal ? baseline : comparisons[0][1]);
            expect(seen).toEqual(equal ? [] : [[2]]);
            expect(value.getVersion()).toBe(equal ? 0 : 1);
            expect(token(value)).toBe(equal ? 0 : 1);
        } finally {
            value.unsubscribe(id);
        }
    });
});
