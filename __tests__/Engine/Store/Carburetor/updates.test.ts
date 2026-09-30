import {getTestData, ItemListCarburetor, readsOf, TestCarburetor} from "./fixtures";

describe('Carburetor', () => {
    test('update publishes the writes that landed before the callback threw', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];
        let readerOfA = 0;
        let readerOfB = 0;
        const versionBefore = carburetor.getVersion();

        console.error = (message: string) => reported.push(message);
        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        try {
            expect(() => carburetor.throwAfterWrite(1)).toThrow('mutate failed halfway');

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        // The write was already in the data when the callback threw, so it is published:
        // subscribers see the state as it is, and the dev check stays quiet about it.
        expect(carburetor.getData().a).toEqual(1);
        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore + 1);
        expect(reported).toEqual([]);
    });

    test('a throw before any write publishes nothing', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;
        const versionBefore = carburetor.getVersion();

        carburetor.subscribe(() => calls++, {id: 'a-reader', reads: readsOf('a')});

        expect(() => {
            carburetor.update(() => {
                throw new Error('died before touching anything');
            });
        }).toThrow('died before touching anything');

        expect(carburetor.getData().a).toEqual(0);
        expect(calls).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore);
    });

    test('reassigning proxy-read-back elements without a change wakes nobody', () => {
        const first = {n: 1};
        const second = {n: 2};
        const carburetor = new ItemListCarburetor({items: [first, second]});
        let calls = 0;
        const versionBefore = carburetor.getVersion();

        carburetor.subscribe(() => calls++, {id: 'items-reader', reads: readsOf('items')});

        carburetor.selfReassign();

        expect(calls).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore);
        // The plain data keeps the raw elements: a proxy must not leak into it.
        expect(carburetor.getData().items[0]).toBe(first);
        expect(carburetor.getData().items[1]).toBe(second);
    });

    test('sorting an already ordered array of objects wakes nobody', () => {
        const first = {n: 1};
        const second = {n: 2};
        const third = {n: 3};
        const carburetor = new ItemListCarburetor({items: [first, second, third]});
        let calls = 0;
        const versionBefore = carburetor.getVersion();

        carburetor.subscribe(() => calls++, {id: 'items-reader', reads: readsOf('items')});

        carburetor.sortItems();

        expect(calls).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore);
        expect(carburetor.getData().items[0]).toBe(first);
        expect(carburetor.getData().items[2]).toBe(third);
    });

    test('an actual reorder of an object array is still recorded and published', () => {
        const first = {n: 2};
        const second = {n: 1};
        const carburetor = new ItemListCarburetor({items: [first, second]});
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'items-reader', reads: readsOf('items')});

        carburetor.sortItems();

        expect(calls).toEqual(1);
        expect(carburetor.getData().items[0]).toBe(second);
        expect(carburetor.getData().items[1]).toBe(first);
    });

    test('assigning a genuinely different object through draft still wakes subscribers', () => {
        const first = {n: 1};
        const second = {n: 2};
        const carburetor = new ItemListCarburetor({items: [first, second]});
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'items-reader', reads: readsOf('items')});

        carburetor.replaceFirst({n: 9});

        expect(calls).toEqual(1);
        expect(carburetor.getData().items[0]).toEqual({n: 9});
        expect(carburetor.getData().items[1]).toBe(second);
    });

    test('a getData write alone still wakes everyone', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setBThroughGetData(1);

        expect(carburetor.getData().b).toEqual(1);
        expect(readerOfB).toEqual(1);
    });

    test('a getData write mixed with draft writes wakes nobody for itself', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setAandUntrackedB(1, 1);

        // The draft write is precise; the blind write is lost — the state changed, but
        // nobody reading `b` is told. markAllChanged() is the way to own such a write.
        expect(carburetor.getData().b).toEqual(1);
        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('markAllChanged publishes writes that bypassed draft', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;
        const versionBefore = carburetor.getVersion();

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setAandUntrackedBWithMark(1, 1);

        expect(carburetor.getData().a).toEqual(1);
        expect(carburetor.getData().b).toEqual(1);
        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(1);
        expect(carburetor.getVersion()).toEqual(versionBefore + 1);
    });

    test('an empty writes Set is reused across no-op emits, not reallocated (R15-09)', () => {
        const carburetor = new TestCarburetor(getTestData());
        const before = carburetor.writesRef();

        carburetor.touchDraftWithoutWrite();
        carburetor.touchDraftWithoutWrite();

        expect(carburetor.writesRef()).toBe(before);
    });

    test('a real write still gets a fresh writes Set once it is handed off (R15-09)', () => {
        const carburetor = new TestCarburetor(getTestData());
        const empty = carburetor.writesRef();

        carburetor.setA(1);

        // The Set handed to notifyWrites is not reused for the next round of writes: the
        // no-op reuse above must not leak into an emit that actually publishes something.
        expect(carburetor.writesRef()).not.toBe(empty);
        expect(carburetor.writesRef().size).toEqual(0);
    });

    test('several throwing subscribers are all isolated and all reported (R15-09)', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];
        let readerOfB = 0;

        console.error = (message: string) => reported.push(message);
        const throwing = (text: string) => () => { throw new Error(text); };

        carburetor.subscribe(throwing('first reader threw'), {id: 'a-reader-1', reads: readsOf('a')});
        carburetor.subscribe(throwing('second reader threw'), {id: 'a-reader-2', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        try {
            carburetor.setAandUntrackedBWithMark(1, 1);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        // Both throwing subscribers ran and both were reported; neither swallowed the
        // notification meant for the subscriber that does not throw.
        expect(readerOfB).toEqual(1);
        expect(reported.some(message => message.includes('first reader threw'))).toBeTruthy();
        expect(reported.some(message => message.includes('second reader threw'))).toBeTruthy();
    });
});
