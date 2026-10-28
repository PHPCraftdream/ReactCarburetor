import {rstest} from '@rstest/core';
import {Carburetor} from "@/Carburetor";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";
import {buildPersistentView} from "@/Carburetor/Component/Connection/buildPersistentView";
import {declareConnection} from "@/Carburetor/Component/Connection/declareConnection";
import type {IConnection} from "@/Carburetor/Component/Models/Connection";
import {reportLiveViewEscape} from "@/Carburetor/Component/Connection/reportLiveViewEscape";

const declare = <T extends object>(store: Carburetor<T>) =>
    declareConnection<T>([] as IConnection[], () => undefined, () => store);

describe('Connection selection comparison gaps', () => {
    test('sparse array walk compares indexed keys, ignores symbol keys, and reads the fresh indexed value', () => {
        const symbol = Symbol('metadata');
        const previous: unknown[] = [];
        const next: unknown[] = [];
        previous[2] = 'same';
        next[2] = 'same';
        Object.defineProperty(previous, symbol, {value: 1});
        Object.defineProperty(next, symbol, {value: 2});
        expect(sameSelection(previous, next)).toBe(true);

        let reads = 0;
        const sparse: unknown[] = [];
        Object.defineProperty(sparse, '2', {
            enumerable: true,
            configurable: true,
            get: () => {
                reads++;
                return 'changed';
            },
        });
        expect(sameSelection(previous, sparse)).toBe(false);
        expect(reads).toBe(1);
    });

    test('map content equality detects ordered key mismatch and recursively changed values', () => {
        expect(sameSelection(new Map([['a', 1], ['b', 2]]), new Map([['b', 2], ['a', 1]]))).toBe(false);
        expect(sameSelection(new Map([['a', {n: 1}]]), new Map([['a', {n: 2}]]))).toBe(false);
    });
});

describe('Persistent connection facade gaps', () => {
    test('persistent object facade follows replacement and rejects a root-kind change', () => {
        const store = new Carburetor<{value: number}>({value: 1});
        const view = buildPersistentView(declare(store));
        expect(view.value).toBe(1);
        store.setData({value: 2});
        expect(view.value).toBe(2);
        (store as unknown as Carburetor<object>).setData([3]);
        expect(() => Reflect.get(view, 'value')).toThrow(/array/);
    });
});

describe('Persistent connection escape diagnostics', () => {
    test('custom-root facade is reported at detachment', () => {
        class CustomRoot {
            public value = 1;
        }
        const store = new Carburetor(new CustomRoot());
        const view = buildPersistentView(declare(store));
        const diagnostic = rstest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            expect(reportLiveViewEscape({nested: view})).toBe(true);
            expect(diagnostic).toHaveBeenCalledTimes(1);
            expect(diagnostic).toHaveBeenCalledWith(
                'Carburetor: a connectSelection() snapshot handed a child a live store view at "nested". ' +
                'A child reading it in its own render records nothing, so no subscription covers what it sees ' +
                'and it never hears about changes. Select plain values — primitives, or plain objects and arrays ' +
                'built from them.'
            );
        } finally {
            diagnostic.mockRestore();
        }
    });
});
