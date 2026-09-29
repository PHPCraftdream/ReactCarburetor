import {diagnostics} from "@/Carburetor";
import {TPath} from "@/Carburetor/Models/Paths";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";
import {transferReads} from "@/Carburetor/Store/Paths/Markers/transferReads";
import {
    FakeReadonlySet, getTestData, InspectableCarburetor, readsOf, SwappingCarburetor, TestCarburetor,
} from "./fixtures";

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

    test('setData replaces data, waking only the readers of what changed (R16-02)', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        const next = getTestData();
        next.a = 5;
        carburetor.setData(next);

        // Identity contract unchanged: getData() answers the exact object handed in.
        expect(carburetor.getData()).toBe(next);
        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('setData with an identical deep copy wakes nobody (R16-02)', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher'});
        carburetor.setData(getTestData());

        expect(calls).toEqual(0);
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

    test('mutating the read set after subscribing does not widen the subscription', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = readsOf('a');
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads});

        // The public path copies `reads` into the store's own Set; either way matching goes
        // through the index (exact/branch), filed once at subscribe time: adding to the caller's
        // set directly, bypassing extend(), leaves the index untouched, so the subscription
        // does not widen.
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

    test('enumerating a branch subscribes to its key-set marker, not the branch itself (R16-01)', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = new Set<TPath>();

        const data = carburetor.read((path: TPath) => reads.add(path));
        const keys = Object.keys(data.nested);

        expect(keys).toEqual(['value']);
        expect(reads.has('nested')).toBeFalsy();
        expect(reads.has('nested.~k')).toBeTruthy();
    });

    test('extend wakes the subscriber on a write to the newly added path', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads: readsOf('a')});
        carburetor.extend('subscriber', 'b');

        carburetor.setB(2);
        expect(calls).toEqual(1);

        carburetor.setA(1);
        expect(calls).toEqual(2);
    });

    test('extend on an unknown id is a no-op', () => {
        const carburetor = new TestCarburetor(getTestData());

        expect(() => carburetor.extend('ghost', 'a')).not.toThrow();

        // A later subscription under that same id starts from nothing: the earlier no-op
        // extend call left no trace to inherit.
        let calls = 0;
        carburetor.subscribe(() => calls++, {id: 'ghost', reads: readsOf('b')});
        carburetor.setA(1);
        expect(calls).toEqual(0);
    });

    test('unsubscribe after extend cleans up both the original and the extended path', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads: readsOf('a')});
        carburetor.extend('subscriber', 'b');
        carburetor.unsubscribe('subscriber');

        carburetor.setA(1);
        carburetor.setB(2);
        expect(calls).toEqual(0);
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

describe('subscribe() copies the public reads Set, transfers only the branded internal one (R6-04)', () => {
    test('clearing the caller\'s own Set after subscribing does not desync a later re-subscribe', () => {
        const carburetor = new TestCarburetor(getTestData());
        const mine = readsOf('a');
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'x', reads: mine});

        // The store's copy of `mine` is unaffected: without the fix this clear would reach the
        // very Set the index diffs re-registrations against, and the re-subscribe below would
        // never see 'a' to unfile it.
        mine.clear();
        carburetor.subscribe(() => calls++, {id: 'x', reads: readsOf('b')});

        carburetor.setA(1);
        expect(calls).toEqual(0);

        carburetor.setB(1);
        expect(calls).toEqual(1);
    });

    test('re-subscribing with the same, mutated-in-place Set instance still reconciles by content', () => {
        const carburetor = new TestCarburetor(getTestData());
        const mine = readsOf('a');
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'x', reads: mine});

        // Same object, different content: the public path always copies afresh, so the second
        // subscribe cannot mistake this for an unchanged re-registration by identity.
        mine.clear();
        mine.add('b');
        carburetor.subscribe(() => calls++, {id: 'x', reads: mine});

        carburetor.setA(1);
        expect(calls).toEqual(0);

        carburetor.setB(1);
        expect(calls).toEqual(1);
    });

    test('a non-Set ReadonlySet implementation does not throw, and extend() still works', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        const id = carburetor.subscribe(() => calls++, {id: 'x', reads: new FakeReadonlySet(['a'])});

        expect(() => carburetor.extend(id, 'b')).not.toThrow();

        carburetor.setB(1);
        expect(calls).toEqual(1);
    });

    test('extend() grows the store\'s own copy, never the caller\'s Set', () => {
        const carburetor = new TestCarburetor(getTestData());
        const mine = readsOf('a');

        const id = carburetor.subscribe(() => undefined, {id: 'x', reads: mine});

        carburetor.extend(id, 'b');

        expect(mine.size).toEqual(1);
        expect(mine.has('b')).toBe(false);
    });

    test('an override that swaps out options.reads on the public path still gets a copy', () => {
        const carburetor = new SwappingCarburetor(getTestData());

        const id = carburetor.subscribe(() => undefined, {id: 'x', reads: readsOf('a')});

        // The Set actually reaching Carburetor.subscribe is carburetor.swappedReads, not the
        // caller's original — the public path copies it regardless.
        expect(carburetor.readsFor(id)).not.toBe(carburetor.swappedReads);
        expect(carburetor.readsFor(id)).toEqual(carburetor.swappedReads);
    });

    test('transferReads() adopts the exact Set instance for an internal caller', () => {
        const carburetor = new InspectableCarburetor(getTestData());
        const mine = readsOf('a');

        const id = carburetor.subscribe(() => undefined, transferReads(mine, 'x'));

        expect(carburetor.readsFor(id)).toBe(mine);
    });

    test('an override that swaps out options.reads breaks the brand, so transferReads() copies', () => {
        const carburetor = new SwappingCarburetor(getTestData());
        const mine = readsOf('a');

        const id = carburetor.subscribe(() => undefined, transferReads(mine, 'x'));

        // The brand still points at `mine`, but options.reads is now carburetor.swappedReads —
        // the mismatch must fall back to a safe copy of whatever was actually given.
        expect(carburetor.readsFor(id)).not.toBe(mine);
        expect(carburetor.readsFor(id)).not.toBe(carburetor.swappedReads);
        expect(carburetor.readsFor(id)).toEqual(carburetor.swappedReads);
    });
});
