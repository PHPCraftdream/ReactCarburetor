import {detachSelection} from "@/Carburetor/Component/Connection/detachSelection";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";
import {shallowEqual} from "@/Carburetor/Component/shallowEqual";

describe('sameSelection reference topology (R5-01)', () => {
    test('one previous object behind two keys is a change when the fresh side holds two equal copies', () => {
        const shared = {v: 1};

        expect(sameSelection({left: shared, right: shared}, {left: {v: 1}, right: {v: 1}})).toBe(false);
    });

    test('two previous objects behind two keys are a change when the fresh side holds one shared copy', () => {
        const shared = {v: 1};

        expect(sameSelection({left: {v: 1}, right: {v: 1}}, {left: shared, right: shared})).toBe(false);
    });

    test('matching reference sharing on both sides compares equal', () => {
        const previousShared = {v: 1};
        const freshShared = {v: 1};

        expect(sameSelection({left: previousShared, right: previousShared}, {left: freshShared, right: freshShared}))
            .toBe(true);
        expect(sameSelection({left: previousShared, right: previousShared}, {left: freshShared, right: {v: 1}}))
            .toBe(false);
    });

    test('topology is tracked through nesting and array members', () => {
        const shared = {v: 1};

        expect(sameSelection({rows: [{l: shared}, {r: shared}]}, {rows: [{l: {v: 1}}, {r: {v: 1}}]})).toBe(false);
        expect(sameSelection([shared, shared], [{v: 1}, {v: 1}])).toBe(false);
        expect(sameSelection([shared, shared], [shared, shared])).toBe(true);
    });

    test('a null-prototype dictionary and an ordinary object with the same fields are different', () => {
        const dictionary = Object.assign(Object.create(null), {v: 1});

        expect(sameSelection({item: dictionary}, {item: {v: 1}})).toBe(false);
        expect(sameSelection(dictionary, {v: 1})).toBe(false);
        expect(sameSelection({item: dictionary}, {item: Object.assign(Object.create(null), {v: 1})})).toBe(true);
    });
});

describe('sameSelection ordered own keys', () => {
    test('equal entries in a new insertion order are distinct; equal order stays equal', () => {
        expect(sameSelection({item: {a: 1, b: 2}}, {item: {b: 2, a: 1}})).toBe(false);
        expect(sameSelection({item: {a: 1, b: 2}}, {item: {a: 1, b: 2}})).toBe(true);
        // Integer keys have native numeric order regardless of insertion order.
        expect(sameSelection({'10': 10, '2': 2}, {'2': 2, '10': 10})).toBe(true);
    });
});

describe('sameSelection selection model is own enumerable string keys (R30-04)', () => {
    const first = Symbol('first');
    const second = Symbol('second');

    test('symbol keys are not part of a selection', () => {
        const previous = {a: 1, [first]: 2};

        expect(sameSelection(previous, {a: 1})).toBe(true);
        expect(sameSelection({a: 1}, {a: 1, [second]: 3})).toBe(true);
    });

    test('non-enumerable keys and descriptor flags are not part of a selection', () => {
        const previous = Object.defineProperty({a: 1, b: 2}, 'hidden', {
            value: 3, enumerable: false, configurable: true, writable: true,
        });
        const fresh = Object.defineProperty({a: 1, b: 2}, 'hidden', {
            value: 4, enumerable: false, configurable: false, writable: false,
        });

        expect(sameSelection(previous, fresh)).toBe(true);
    });

    test('array custom properties are not part of a selection; elements and length are', () => {
        expect(sameSelection(Object.assign([1, 2], {extra: 1}), Object.assign([1, 2], {extra: 2}))).toBe(true);
        expect(sameSelection([1, 2], [1, 3])).toBe(false);
        expect(sameSelection([1, 2], [1, 2, 3])).toBe(false);
    });

    test('holes compare as holes', () => {
        const withHoles: unknown[] = [];

        withHoles[2] = 'x';

        const withUndefined: unknown[] = [undefined, undefined, 'x'];

        expect(sameSelection(withHoles, withHoles.slice())).toBe(true);
        expect(sameSelection(withHoles, withUndefined)).toBe(false);
    });

    test('an accessor is read like any plain field and its snapshot participates', () => {
        let calls = 0;
        const previous = {a: 1, b: 9};
        const fresh = {a: 1};

        Object.defineProperty(fresh, 'b', {
            enumerable: true,
            configurable: true,
            get: (): number => {
                calls++;

                return 9;
            },
        });

        expect(sameSelection(previous, fresh)).toBe(true);
        // The value read is what the comparison saw: a different value behind the same key
        // set is a change, read exactly once.
        expect(calls).toBe(1);

        Object.defineProperty(fresh, 'b', {
            enumerable: true,
            configurable: true,
            get: (): number => {
                calls++;

                return 10;
            },
        });

        expect(sameSelection(previous, fresh)).toBe(false);
        expect(calls).toBe(2);
    });
});

describe('sameSelection detached Date/Map/Set compare by content (R30-03)', () => {
    test('an unchanged detached Date equals the live one; a changed time does not', () => {
        const live = new Date(1000);

        expect(sameSelection(detachSelection(live), live)).toBe(true);
        expect(sameSelection(new Date(1000), new Date(2000))).toBe(false);
    });

    test('an unchanged detached Map equals the live one; a new entry does not', () => {
        const live = new Map([['a', 1]]);

        expect(sameSelection(detachSelection(live), live)).toBe(true);
        live.set('b', 2);
        expect(sameSelection(detachSelection(new Map([['a', 1]])), live)).toBe(false);
        expect(sameSelection(new Map([['a', 1]]), new Map([['a', 1], ['b', 2]]))).toBe(false);
    });

    test('an unchanged detached Set equals the live one; a new member does not', () => {
        const live = new Set(['x']);

        expect(sameSelection(detachSelection(live), live)).toBe(true);
        expect(sameSelection(new Set(['x']), new Set(['x', 'y']))).toBe(false);
    });

    test('Date/Map/Set pairs register in the topology maps', () => {
        const date = new Date(5);
        const previous = {one: date, two: date};
        const fresh = {one: new Date(5), two: new Date(5)};

        expect(sameSelection(previous, fresh)).toBe(false);
        expect(sameSelection({one: date, two: date}, {one: date, two: date})).toBe(true);
    });

    test('a Map with an object key compares conservatively as changed', () => {
        const key = {id: 1};
        const value = {v: 1};

        expect(sameSelection(new Map([[key, value]]), new Map([[key, value]]))).toBe(false);
    });

    test('nested Date/Map/Set values compare recursively inside Map entries', () => {
        const previous = new Map<string, unknown>([['at', new Date(7)]]);
        const fresh = new Map<string, unknown>([['at', new Date(7)]]);

        expect(sameSelection(previous, fresh)).toBe(true);

        fresh.set('at', new Date(8));
        expect(sameSelection(previous, fresh)).toBe(false);
    });

    test('a class instance is always a change, even against itself', () => {
        class Box {
            public constructor(public v: number) {}
        }

        const box = new Box(1);

        expect(sameSelection({box}, {box})).toBe(false);
        expect(sameSelection(box, box)).toBe(false);
    });

    test('a Date/Map/Set subclass is a class instance and always a change', () => {
        class TaggedDate extends Date {
            public tag = 'd';
        }

        const tagged = new TaggedDate(1000);

        expect(sameSelection(tagged, tagged)).toBe(false);
        expect(sameSelection(tagged, new Date(1000))).toBe(false);
    });

    test('plain-data verdicts around the native branches are unchanged', () => {
        expect(sameSelection({a: 1, b: 'x'}, {a: 1, b: 'x'})).toBe(true);
        expect(sameSelection({a: 1}, {a: 2})).toBe(false);
        expect(sameSelection({a: undefined}, {b: undefined})).toBe(false);
    });
});

describe('sameSelection cycles (round-3 contract preserved)', () => {
    interface ICyclic {
        v: number;
        self?: unknown;
    }

    test('equal single-node cycles compare equal', () => {
        const previous: ICyclic = {v: 1};

        previous.self = previous;

        const fresh: ICyclic = {v: 1};

        fresh.self = fresh;

        expect(sameSelection(previous, fresh)).toBe(true);
    });

    test('a cycle and a field-equal non-cyclic shape are a change', () => {
        const previous: ICyclic = {v: 1};

        previous.self = previous;

        const fresh: ICyclic = {v: 1};

        fresh.self = {v: 1};

        expect(sameSelection(previous, fresh)).toBe(false);
    });
});

describe('detachSelection preserves what the comparison relies on', () => {
    test('shared references survive as one copy, detached from the source', () => {
        const source = {v: 1};
        const detached = detachSelection({left: source, right: source}) as {left: {v: number}; right: {v: number}};

        expect(detached.left).toBe(detached.right);
        expect(detached.left).not.toBe(source);
    });

    test('a null-prototype dictionary stays null-prototype', () => {
        const detached = detachSelection(Object.assign(Object.create(null), {v: 1})) as {v: number};

        expect(Object.getPrototypeOf(detached)).toBe(null);
        expect(detached.v).toEqual(1);
    });

    test('a cycle survives as the copy pointing at itself', () => {
        const source: {v: number; self?: unknown} = {v: 1};

        source.self = source;

        const detached = detachSelection(source) as {v: number; self?: unknown};

        expect(detached.self).toBe(detached);
        expect(detached).not.toBe(source);
    });

    test('an own key named __proto__ lands as data, not as a prototype reassignment', () => {
        const source: Record<string, unknown> = {v: 1};

        Object.defineProperty(source, '__proto__',
            {value: {v: 2}, enumerable: true, writable: true, configurable: true});

        const detached = detachSelection(source) as Record<string, unknown>;

        expect(Object.getPrototypeOf(detached)).toBe(Object.prototype);
        expect((detached.__proto__ as {v: number}).v).toEqual(2);
        expect(Object.prototype.hasOwnProperty.call(detached, '__proto__')).toBe(true);
    });

    test('symbol keys and non-enumerable keys are not part of a selection (R30-04)', () => {
        const tag = Symbol('tag');
        const source: Record<PropertyKey, unknown> = {v: 1, [tag]: 2};

        Object.defineProperty(source, 'hidden', {value: 3, enumerable: false, configurable: true});

        const detached = detachSelection(source) as Record<PropertyKey, unknown>;

        expect(Object.keys(detached)).toEqual(['v']);
        expect(detached[tag]).toBeUndefined();
        expect(detached.hidden).toBeUndefined();
    });
});

describe('shallowEqual (R16-09 array branch)', () => {
    test('identical reference is equal without inspecting contents', () => {
        const value = {a: 1};

        expect(shallowEqual(value, value)).toBe(true);
    });

    test('primitives compare by Object.is', () => {
        expect(shallowEqual(1, 1)).toBe(true);
        expect(shallowEqual(NaN, NaN)).toBe(true);
        expect(shallowEqual(0, -0)).toBe(false);
        expect(shallowEqual(1, 2)).toBe(false);
        expect(shallowEqual(null, undefined)).toBe(false);
    });

    test('plain objects compare one level deep by key', () => {
        expect(shallowEqual({a: 1, b: 'x'}, {a: 1, b: 'x'})).toBe(true);
        expect(shallowEqual({a: 1}, {a: 2})).toBe(false);
        expect(shallowEqual({a: 1}, {a: 1, b: 2})).toBe(false);
        expect(shallowEqual({a: 1, b: 2}, {a: 1})).toBe(false);
    });

    test('two equal-content arrays compare equal', () => {
        expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    test('arrays of different length are unequal', () => {
        expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    test('arrays with a differing element at the same index are unequal', () => {
        expect(shallowEqual([1, 2, 3], [1, 9, 3])).toBe(false);
    });

    test('element comparison is Object.is, so NaN compares equal and 0/-0 do not', () => {
        expect(shallowEqual([NaN], [NaN])).toBe(true);
        expect(shallowEqual([0], [-0])).toBe(false);
    });

    test('a large id-array pair compares equal via the index loop', () => {
        const ids = Array.from({length: 4000}, (_, i) => `id-${i}`);

        expect(shallowEqual(ids, ids.slice())).toBe(true);
        expect(shallowEqual(ids, [...ids.slice(0, -1), 'different'])).toBe(false);
    });

    // R16-09 narrows this on purpose: the fast array/array path compares length and index
    // alone, so an own property outside the index range no longer takes part — unlike the
    // general Object.keys-based branch below, which still would. Fails against the pre-fix
    // code (which returns false here via the 'tag' mismatch).
    test('two arrays are compared by length and index alone, ignoring an extra own property', () => {
        const left = Object.assign([1, 2], {tag: 'left'});
        const right = Object.assign([1, 2], {tag: 'right'});

        expect(shallowEqual(left, right)).toBe(true);
    });

    // Preserved from before the array branch existed: an array and a plain object that happen
    // to carry the same numeric keys still fall through to the general branch, not a hard
    // `false`.
    test('an array against a plain object with the same numeric keys still compares by the general branch', () => {
        expect(shallowEqual([1, 2], {0: 1, 1: 2})).toBe(true);
        expect(shallowEqual([1, 2], {0: 1})).toBe(false);
        expect(shallowEqual({0: 1, 1: 2}, [1, 2])).toBe(true);
    });
});
