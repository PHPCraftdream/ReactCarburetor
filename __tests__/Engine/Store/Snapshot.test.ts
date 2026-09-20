import {Carburetor, deepClone, TPath, transaction} from "@/Carburetor";

interface ITestData {
    a: number;
    nested: {
        list: number[];
    };
}

const getTestData = (): ITestData => ({a: 0, nested: {list: [1, 2]}});

class TestCarburetor extends Carburetor<ITestData> {
    public setA = (a: number) => {
        this.draft.a = a;

        this.emitUpdate();
    };

    public pushToList = (value: number) => {
        this.draft.nested.list.push(value);

        this.emitUpdate();
    };
}

describe('snapshot / restore', () => {
    test('snapshot is detached from the store', () => {
        const carburetor = new TestCarburetor(getTestData());
        const taken = carburetor.snapshot();

        carburetor.setA(5);
        carburetor.pushToList(3);

        expect(taken.a).toEqual(0);
        expect(taken.nested.list).toEqual([1, 2]);
        expect(carburetor.getData().a).toEqual(5);
        expect(carburetor.getData().nested.list).toEqual([1, 2, 3]);
    });

    test('restore brings the state back and notifies', () => {
        const carburetor = new TestCarburetor(getTestData());
        const taken = carburetor.snapshot();
        let calls = 0;

        carburetor.setA(5);
        carburetor.subscribe(() => calls++, {id: 'watcher'});

        carburetor.restore(taken);

        expect(carburetor.getData().a).toEqual(0);
        expect(calls).toEqual(1);
    });

    test('restore detaches from the snapshot it was given', () => {
        const carburetor = new TestCarburetor(getTestData());
        const taken = carburetor.snapshot();

        carburetor.restore(taken);
        carburetor.setA(7);

        expect(taken.a).toEqual(0);
    });

    test('toJSON round-trips through JSON', () => {
        const carburetor = new TestCarburetor(getTestData());
        carburetor.setA(9);

        const wire = JSON.stringify(carburetor);
        const restored = new TestCarburetor(getTestData());
        restored.fromJSON(JSON.parse(wire));

        expect(restored.getData()).toEqual(carburetor.getData());
    });

    test('deepClone carries non-plain values by reference', () => {
        const date = new Date(0);
        const source = {date, list: [1]};
        const clone = deepClone(source);

        expect(clone.date).toBe(date);
        expect(clone.list).not.toBe(source.list);
    });
});

describe('watch', () => {
    test('reacts to writes under the watched paths only', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        const dispose = carburetor.watch(new Set<TPath>(['a']), () => calls++);

        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.pushToList(3);
        expect(calls).toEqual(1);

        dispose();
        carburetor.setA(2);
        expect(calls).toEqual(1);
    });
});

describe('transaction', () => {
    test('collapses several writes into one notification', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher'});

        transaction(() => {
            carburetor.setA(1);
            carburetor.setA(2);
            carburetor.pushToList(3);
        });

        expect(calls).toEqual(1);
        expect(carburetor.getData().a).toEqual(2);
        expect(carburetor.getData().nested.list).toEqual([1, 2, 3]);
    });

    test('keeps path precision across the whole transaction', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfList = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: new Set<TPath>(['a'])});
        carburetor.subscribe(() => readerOfList++, {id: 'list-reader', reads: new Set<TPath>(['nested.list'])});

        transaction(() => {
            carburetor.setA(1);
        });

        expect(readerOfA).toEqual(1);
        expect(readerOfList).toEqual(0);
    });

    test('batches writes made to several carburetors', () => {
        const first = new TestCarburetor(getTestData());
        const second = new TestCarburetor(getTestData());
        const order: string[] = [];

        first.subscribe(() => order.push('first'), {id: 'w1'});
        second.subscribe(() => order.push('second'), {id: 'w2'});

        transaction(() => {
            first.setA(1);
            second.setA(1);
            first.setA(2);
        });

        expect(order).toEqual(['first', 'second']);
    });

    test('nested transactions flush once, at the outermost exit', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher'});

        transaction(() => {
            carburetor.setA(1);

            transaction(() => {
                carburetor.setA(2);
            });

            expect(calls).toEqual(0);
        });

        expect(calls).toEqual(1);
    });

    test('reports an async body, which the batch cannot cover', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            // The rule is right; this proves the runtime diagnostic reports it too.
            // oxlint-disable-next-line carburetor/no-async-transaction
            await transaction(async () => {
                carburetor.setA(1);
            });
        } finally {
            console.error = original;
        }

        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('async body');
    });

    test('stays quiet for a synchronous body', () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            transaction(() => {
                carburetor.setA(1);
            });
        } finally {
            console.error = original;
        }

        expect(reported).toEqual([]);
    });

    test('notifies even when the body throws', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher'});

        expect(() => {
            transaction(() => {
                carburetor.setA(1);

                throw new Error('boom');
            });
        }).toThrow('boom');

        expect(calls).toEqual(1);
        expect(carburetor.getData().a).toEqual(1);
    });
});
