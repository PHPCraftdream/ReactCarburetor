import {diagnostics, TPath, WILDCARD_PATH} from "@/Carburetor";
import {getTestData, readsOf, TestCarburetor} from "./fixtures";

describe('Carburetor', () => {    test('notifies subscribers synchronously by default', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads: readsOf('a')});

        carburetor.setA(1);

        expect(calls).toEqual(1);
        expect(carburetor.getData().a).toEqual(1);
    });

    test('wakes only subscribers that read the written path', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setA(1);

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);

        carburetor.setB(2);

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(1);
    });

    test('matches nested paths in both directions', () => {
        const carburetor = new TestCarburetor(getTestData());
        let deepReader = 0;
        let containerReader = 0;
        let unrelatedReader = 0;

        carburetor.subscribe(() => deepReader++, {id: 'deep', reads: readsOf('nested.value')});
        carburetor.subscribe(() => containerReader++, {id: 'container', reads: readsOf('nested')});
        carburetor.subscribe(() => unrelatedReader++, {id: 'unrelated', reads: readsOf('a')});

        carburetor.setNestedValue(1);

        expect(deepReader).toEqual(1);
        expect(containerReader).toEqual(1);
        expect(unrelatedReader).toEqual(0);
    });

    test('subscriber without a read set gets every update', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'wildcard'});

        carburetor.setA(1);
        carburetor.setB(2);

        expect(calls).toEqual(2);
    });

    test('falls back to waking everyone when writes bypass draft', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setAUntracked(1);

        expect(readerOfB).toEqual(1);
    });

    test('setData replaces data and invalidates everything', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        const next = getTestData();
        next.a = 5;
        carburetor.setData(next);

        expect(carburetor.getData()).toEqual(next);
        expect(readerOfB).toEqual(1);
    });

    test('unsubscribe stops notifications', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads: readsOf('a')});
        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.unsubscribe('subscriber');
        carburetor.setA(2);

        expect(calls).toEqual(1);
    });

    test('update mutates and publishes once, keeping path precision', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setAThroughUpdate(1);

        expect(carburetor.getData().a).toEqual(1);
        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('reports a draft write that was never published', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            carburetor.setAWithoutEmit(1);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('emitUpdate');
    });

    test('reports an async mutation handed to update', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];
        let calls = 0;

        console.error = (message: string) => reported.push(message);
        carburetor.subscribe(() => calls++, {id: 'a-reader', reads: readsOf('a')});

        try {
            carburetor.setAThroughAsyncUpdate(1);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('promise');
        // The hazard itself: the value did change, and nobody was woken for it.
        expect(carburetor.getData().a).toEqual(1);
        expect(calls).toEqual(0);
    });

    test('stays quiet when the write is published', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            carburetor.setAThroughUpdate(1);
            carburetor.setA(2);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        expect(reported).toEqual([]);
    });

    test('diagnostics can be switched off', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);
        diagnostics.setEnabled(false);

        try {
            carburetor.setAWithoutEmit(1);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            diagnostics.setEnabled(true);
            console.error = original;
        }

        expect(reported).toEqual([]);
    });

    test('diagnostics are on by default outside production', () => {
        expect(diagnostics.isEnabled()).toBeTruthy();
    });

    test('survives a subscriber unsubscribing another during delivery', () => {
        const carburetor = new TestCarburetor(getTestData());
        let tail = 0;

        carburetor.subscribe(() => carburetor.unsubscribe('tail'), {id: 'head'});
        carburetor.subscribe(() => tail++, {id: 'tail'});

        expect(() => carburetor.setA(1)).not.toThrow();
        expect(tail).toEqual(0);
    });

    test('subscribing with the same id replaces the previous registration', () => {
        const carburetor = new TestCarburetor(getTestData());
        let first = 0;
        let second = 0;

        carburetor.subscribe(() => first++, {id: 'same', reads: readsOf('a')});
        carburetor.subscribe(() => second++, {id: 'same', reads: readsOf('a')});

        carburetor.setA(1);

        expect(first).toEqual(0);
        expect(second).toEqual(1);
    });

    test('the read set handed to subscribe is copied, not held live', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = readsOf('a');
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads});

        // Extending the caller's set afterwards must not widen the subscription.
        reads.add('b');
        carburetor.setB(1);

        expect(calls).toEqual(0);

        carburetor.setA(1);
        expect(calls).toEqual(1);
    });

    test('version grows with every update', () => {
        const carburetor = new TestCarburetor(getTestData());
        const initial = carburetor.getVersion();

        carburetor.setA(1);
        carburetor.setB(2);

        expect(carburetor.getVersion()).toEqual(initial + 2);
    });

    test('read tracks leaves, not traversal through branches', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = new Set<TPath>();

        const data = carburetor.read((path: TPath) => reads.add(path));
        const used = data.a + data.nested.value;

        expect(used).toEqual(0);
        expect(reads.has('a')).toBeTruthy();
        expect(reads.has('nested.value')).toBeTruthy();
        // Traversing through `nested` does not become a subscription on its own.
        expect(reads.has('nested')).toBeFalsy();
        expect(reads.has('b')).toBeFalsy();
        expect(reads.has(WILDCARD_PATH)).toBeFalsy();
    });

    test('enumerating a branch subscribes to the branch itself', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = new Set<TPath>();

        const data = carburetor.read((path: TPath) => reads.add(path));
        const keys = Object.keys(data.nested);

        expect(keys).toEqual(['value']);
        expect(reads.has('nested')).toBeTruthy();
    });

    test('writing the same value wakes nobody', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'a-reader', reads: readsOf('a')});

        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.setA(2);
        expect(calls).toEqual(2);
    });

});
