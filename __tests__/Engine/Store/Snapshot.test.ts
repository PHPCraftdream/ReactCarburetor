import {Carburetor, deepClone, TPath, transaction} from "@/Carburetor";

interface ITestData {
    a: number;
    nested: {
        list: number[];
    };
}

const getTestData = (): ITestData => ({a: 0, nested: {list: [1, 2]}});

const TAG = Symbol('tag');
const DEEP_TAG = Symbol('deepTag');

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

    // R4-02: `target[key] = value` for a key literally named `__proto__` invokes the inherited
    // accessor setter instead of installing an own data property, silently losing the key and
    // repointing the copy's own prototype.
    test('a snapshot round trip preserves an own __proto__ key at the root (R4-02)', () => {
        const parsed = JSON.parse('{"__proto__":{"n":7},"safe":1}') as Record<string, unknown>;

        // JSON.parse never touches prototypes: this is an own, enumerable, ordinary data key.
        expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toEqual(true);
        expect(Object.getPrototypeOf(parsed)).toEqual(Object.prototype);

        const carburetor = new TestCarburetor(parsed as unknown as ITestData);
        const taken = carburetor.snapshot() as unknown as Record<string, unknown>;

        expect(Object.getPrototypeOf(taken)).toEqual(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(taken, '__proto__')).toEqual(true);
        expect(taken.__proto__).toEqual({n: 7});
        expect(taken.safe).toEqual(1);
        // A `{__proto__: ...}` object-literal key is spec-special-cased to set the prototype
        // instead of an own key, so the expectation must use a computed key to mean an own one.
        expect(JSON.parse(JSON.stringify(taken))).toEqual({['__proto__']: {n: 7}, safe: 1});
    });

    test('a snapshot round trip preserves an own __proto__ key nested inside another object (R4-02)', () => {
        const parsed = JSON.parse('{"outer":{"__proto__":{"n":7},"safe":1}}') as Record<string, unknown>;
        const outer = parsed.outer as Record<string, unknown>;

        expect(Object.prototype.hasOwnProperty.call(outer, '__proto__')).toEqual(true);
        expect(Object.getPrototypeOf(outer)).toEqual(Object.prototype);

        const carburetor = new TestCarburetor(parsed as unknown as ITestData);
        const taken = carburetor.snapshot() as unknown as Record<string, unknown>;
        const takenOuter = taken.outer as Record<string, unknown>;

        expect(Object.getPrototypeOf(takenOuter)).toEqual(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(takenOuter, '__proto__')).toEqual(true);
        expect(takenOuter.__proto__).toEqual({n: 7});
        expect(takenOuter.safe).toEqual(1);
        expect(JSON.parse(JSON.stringify(taken))).toEqual({outer: {['__proto__']: {n: 7}, safe: 1}});
    });

    test('deepClone preserves a null-prototype dictionary through the copy (R4-02)', () => {
        const dictionary: Record<string, unknown> = Object.create(null);
        dictionary.a = 1;

        const clone = deepClone({dictionary});

        expect(Object.getPrototypeOf(clone.dictionary)).toBeNull();
        expect(clone.dictionary).toEqual({a: 1});
        expect(clone.dictionary).not.toBe(dictionary);
    });

    // R5-05: Object.keys() sees string keys only, so a symbol-keyed field survived tracking but
    // silently vanished from every local snapshot/restore round trip.
    test('deepClone preserves own enumerable symbol keys (R5-05)', () => {
        const tag = Symbol('tag');
        const deep = Symbol('deep');
        const hidden = Symbol('hidden');
        const source: Record<string | symbol, unknown> = {
            plain: 1,
            [tag]: {count: 1},
            nested: {deep: {[deep]: {n: 2}}},
        };

        // A non-enumerable own symbol is invisible to a spread, so the copy leaves it out too.
        Object.defineProperty(source, hidden, {value: 'secret', enumerable: false});

        const clone = deepClone(source) as Record<string | symbol, unknown>;
        const sourceNested = source.nested as Record<string | symbol, unknown>;
        const cloneNested = clone.nested as Record<string | symbol, unknown>;
        const sourceNestedDeep = sourceNested.deep as Record<string | symbol, unknown>;
        const cloneNestedDeep = cloneNested.deep as Record<string | symbol, unknown>;

        expect(clone.plain).toEqual(1);
        expect(clone[tag]).toEqual({count: 1});
        expect(clone[tag]).not.toBe(source[tag]);
        expect(cloneNestedDeep[deep]).toEqual({n: 2});
        expect(cloneNestedDeep[deep]).not.toBe(sourceNestedDeep[deep]);
        expect(Object.getOwnPropertySymbols(clone)).toEqual([tag]);
    });

    // R5-05: a symbol-keyed field is tracked by the proxies, but snapshot() dropped it and
    // restore() left it absent — a silent loss on a purely local, in-memory round trip.
    test('a snapshot round trip preserves a symbol-keyed field beside a string field (R5-05)', () => {
        const tagValue = {count: 1};
        const initial = {...getTestData(), [TAG]: tagValue} as unknown as ITestData;
        const carburetor = new TestCarburetor(initial);

        const taken = carburetor.snapshot() as unknown as Record<string | symbol, unknown>;

        expect(taken.a).toEqual(0);
        expect(taken[TAG]).toEqual({count: 1});
        expect(taken[TAG]).not.toBe(tagValue);

        carburetor.setData({...getTestData(), a: 5, [TAG]: {count: 99}} as unknown as ITestData);
        carburetor.restore(taken);

        const data = carburetor.getData() as unknown as Record<string | symbol, unknown>;

        expect(data.a).toEqual(0);
        expect(data[TAG]).toEqual({count: 1});
        expect(data[TAG]).not.toBe(taken[TAG]);
        expect(Object.getOwnPropertySymbols(data)).toEqual([TAG]);
    });

    test('a snapshot round trip preserves a symbol key nested several levels deep (R5-05)', () => {
        const deepValue = {n: 7};
        const initial = {
            ...getTestData(),
            nested: {list: [1, 2], deep: {[DEEP_TAG]: deepValue}},
        } as unknown as ITestData;
        const carburetor = new TestCarburetor(initial);

        const taken = carburetor.snapshot() as unknown as {
            nested: {deep: Record<PropertyKey, unknown>};
        };

        expect(taken.nested.deep[DEEP_TAG]).toEqual({n: 7});
        expect(taken.nested.deep[DEEP_TAG]).not.toBe(deepValue);

        // A state swap that lost the symbol-keyed branch entirely must not survive a restore.
        carburetor.setData({...getTestData(), a: 3} as unknown as ITestData);
        carburetor.restore(taken);

        const data = carburetor.getData() as unknown as {
            a: number;
            nested: {list: number[]; deep: Record<PropertyKey, unknown>};
        };

        expect(data.a).toEqual(0);
        expect(data.nested.list).toEqual([1, 2]);
        expect(data.nested.deep[DEEP_TAG]).toEqual({n: 7});
        expect(data.nested.deep[DEEP_TAG]).not.toBe(taken.nested.deep[DEEP_TAG]);
        expect(Object.getOwnPropertySymbols(data.nested.deep)).toEqual([DEEP_TAG]);
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

    test('a carburetor failing to deliver does not abandon the others in the batch', () => {
        const first = new TestCarburetor(getTestData());
        const second = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];
        let notified = 0;

        // notifyWrites is replaced whole so the failure happens at the batch level, above
        // the per-subscriber isolation a throwing subscriber would already be caught by.
        first.notifyWrites = () => {
            throw new Error('first store failed to deliver');
        };

        second.subscribe(() => notified++, {id: 'w2'});

        console.error = (message: string) => reported.push(message);

        try {
            transaction(() => {
                first.setA(1);
                second.setA(1);
            });
        } finally {
            console.error = original;
        }

        expect(notified).toEqual(1);
        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('first store failed to deliver');
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
