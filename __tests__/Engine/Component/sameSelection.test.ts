import {detachSelection} from "@/Carburetor/Component/Connection/detachSelection";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";

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

describe('sameSelection exotic members (R5-02)', () => {
    test('an exotic member is a change even against the same instance', () => {
        const map = new Map([['a', 1]]);

        expect(sameSelection({map}, {map})).toBe(false);
        expect(sameSelection({map}, {map: new Map([['a', 1]])})).toBe(false);
        expect(sameSelection(new Date(0), new Date(0))).toBe(false);
    });

    test('an exotic member nested inside plain containers is a change', () => {
        const when = new Date(0);

        expect(sameSelection({at: [{when}]}, {at: [{when}]})).toBe(false);
    });

    test('plain-data verdicts around the exotic branch are unchanged', () => {
        expect(sameSelection({a: 1, b: 'x'}, {a: 1, b: 'x'})).toBe(true);
        expect(sameSelection({a: 1}, {a: 2})).toBe(false);
        expect(sameSelection({a: undefined}, {b: undefined})).toBe(false);

        const sym = Symbol('r5');

        expect(sameSelection({[sym]: 1}, {[sym]: 1})).toBe(true);
        expect(sameSelection({[sym]: 1}, {[sym]: 2})).toBe(false);

        const previousArray = Object.assign([1, 2], {extra: 1});

        expect(sameSelection(previousArray, Object.assign([1, 2], {extra: 1}))).toBe(true);
        expect(sameSelection(previousArray, Object.assign([1, 2], {extra: 2}))).toBe(false);
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
});
