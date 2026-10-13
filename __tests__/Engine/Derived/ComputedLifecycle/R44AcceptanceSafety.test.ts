import {Carburetor, computed, IComputed, transaction} from '@/Carburetor';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {ILeafVersion} from '@/Carburetor/Derived/Freshness/Models';
import {IDict} from '@/Carburetor/Models/Base';
import {CARBURETOR_SNAPSHOT_VERSION, IInternalSubscriptionProtocol} from '@/Carburetor/Store/Utils/Models';

const token = (value: IComputed<unknown>): number =>
    (value as IInternalSubscriptionProtocol)[CARBURETOR_SNAPSHOT_VERSION]!();

describe('R44-C02 acceptance semantics', () => {
    test.each([false, true])('first subscribe after intervening write, undefined baseline=%s', undefinedBaseline => {
        for (const equal of [false, true]) {
            const store = new Carburetor({n: 1});
            const comparisons: [number | undefined, number | undefined][] = [];
            const value = computed(read => {
                const n = read(store).n;
                return undefinedBaseline && n === 1 ? undefined : n;
            }, {equals: (before, after) => { comparisons.push([before, after]); return equal; }});
            const baseline = value.get();
            store.update(draft => { draft.n = 2; });
            const seen: (number | undefined)[] = [];
            const id = value.subscribe(() => seen.push(value.get()));
            try {
                expect(comparisons).toEqual([[baseline, 2]]);
                expect(value.get()).toBe(equal ? baseline : 2);
                expect(token(value)).toBe(equal ? 0 : 1);
                expect(value.getVersion()).toBe(0);
                expect(seen).toEqual([]);
                store.update(draft => { draft.n = 3; });
                expect(value.get()).toBe(equal ? baseline : 3);
                expect(seen).toEqual(equal ? [] : [3]);
                expect(value.getVersion()).toBe(equal ? 0 : 1);
            } finally { value.unsubscribe(id); }
        }
    });

    test('body and comparator failures on first subscribe retry the original undefined baseline', () => {
        const store = new Carburetor({n: 1});
        const bodyError = new Error('body'), compareError = new Error('comparator');
        let failBody = false, failCompare = true;
        const comparisons: [number | undefined, number | undefined][] = [];
        const value = computed(read => {
            const n = read(store).n;
            if (failBody) throw bodyError;
            return n === 1 ? undefined : n;
        }, {equals: (before, after) => {
            comparisons.push([before, after]);
            if (failCompare) throw compareError;
            return false;
        }});
        expect(value.get()).toBeUndefined();
        const old = computedDependencies.versions.get(value)!() as IDict<ILeafVersion>;
        const oldVersions = Object.values(old).map(record => record.version);
        store.update(draft => { draft.n = 2; });
        failBody = true;
        expect(() => value.subscribe(() => {})).toThrow(bodyError);
        expect(comparisons).toEqual([]);
        failBody = false;
        expect(() => value.subscribe(() => {})).toThrow(compareError);
        expect(() => value.subscribe(() => {})).toThrow(compareError);
        expect(comparisons).toEqual([[undefined, 2], [undefined, 2]]);
        expect(token(value)).toBe(0);
        expect(value.getVersion()).toBe(0);
        expect(Object.values(old).map(record => record.version)).toEqual(oldVersions);
        failCompare = false;
        const seen: (number | undefined)[] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        try {
            expect(value.get()).toBe(2);
            expect(comparisons).toEqual([[undefined, 2], [undefined, 2], [undefined, 2]]);
            expect(token(value)).toBe(1);
            store.update(draft => { draft.n = 3; });
            expect(seen).toEqual([3]);
            expect(value.getVersion()).toBe(1);
        } finally { value.unsubscribe(id); }
    });

    test.each([false, true])('released alias comparator self-read/source-write, throw=%s', throws => {
        const store = new Carburetor({n: 1});
        const group = computed(read => read(store).n);
        const failure = new Error('reentrant comparator');
        let reenter = true, inside = false;
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
                } finally { inside = false; }
                if (throws) throw failure;
            }
            return false;
        };
        const value: IComputed<number[]> = computed(read => [read(group)], {equals: compare});
        const seen: number[][] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        const baseline = value.get();
        value.unsubscribe(id);
        store.update(draft => { draft.n = 2; });
        if (throws) {
            expect(() => value.get()).toThrow(failure);
            expect(token(value)).toBe(0);
            expect(value.get()).toEqual([3]);
            expect(comparisons[1][0]).toBe(baseline);
            expect(token(value)).toBe(1);
        } else {
            const candidate = value.get();
            expect(candidate).toEqual([2]);
            expect(token(value)).toBe(1);
            expect(value.get()).toEqual([3]);
            expect(comparisons[1][0]).toBe(candidate);
            expect(token(value)).toBe(2);
        }
        expect(comparisons[0][0]).toBe(baseline);
        expect(comparisons[0][1]).toEqual([2]);
        expect(value.getVersion()).toBe(0);
        expect(seen).toEqual([]);
    });

    test('observed transaction eager read keeps announcement baseline until settlement', () => {
        const store = new Carburetor({n: 1});
        const group = computed(read => read(store).n);
        const comparisons: [number[], number[]][] = [];
        const value = computed(read => [read(group)], {
            equals: (before, after) => { comparisons.push([before, after]); return false; },
        });
        const seen: number[][] = [];
        const id = value.subscribe(() => seen.push(value.get()));
        const baseline = value.get();
        try {
            transaction(() => {
                store.update(draft => { draft.n = 2; });
                expect(value.get()).toEqual([2]);
                expect(comparisons).toEqual([]);
                expect(seen).toEqual([]);
                expect(value.getVersion()).toBe(0);
            });
            expect(comparisons).toHaveLength(1);
            expect(comparisons[0][0]).toBe(baseline);
            expect(seen).toEqual([[2]]);
            expect(value.getVersion()).toBe(1);
        } finally { value.unsubscribe(id); }
    });
});
