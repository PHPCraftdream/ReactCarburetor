import {reconcileSelection} from "@/Carburetor/Store/Utils/Selection/reconcileSelection";

class Instance {
    public n: number;

    public constructor(n: number) {
        this.n = n;
    }
}

class RowList extends Array<number> {
    public tag = 'rows';
}

const rejectAll = (instance: object): never => {
    throw new Error('rejected: ' + Object.getPrototypeOf(instance)?.constructor?.name);
};

const ownProtoKey = (value: unknown): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, '__proto__');
    return descriptor === undefined ? undefined : descriptor.value;
};

describe('reconcileSelection (R34-02 fused reconcile with structural sharing)', () => {
    test('an unchanged tree hands back the previous snapshot itself', () => {
        const stamp = new Date(1);
        const inner = {n: 1};
        const previous = {
            list: [inner, {d: stamp}],
            m: new Map<string, unknown>([['k', {v: 1}]]),
            s: new Set<string>(['a', 'b']),
        };
        // Same content, all fresh containers (the shape a live read produces after a write elsewhere).
        const live = {
            list: [{n: 1}, {d: new Date(1)}],
            m: new Map<string, unknown>([['k', {v: 1}]]),
            s: new Set<string>(['a', 'b']),
        };

        expect(reconcileSelection(previous, live)).toBe(previous);
    });

    test('one changed leaf copies only its spine and reuses every sibling', () => {
        const previous = [{id: 0}, {id: 1}, {id: 2}];
        const live = [{id: 0}, {id: 1}, {id: 5}];

        const result = reconcileSelection<typeof previous>(previous, live);

        expect(result).not.toBe(previous);
        expect(result).toHaveLength(previous.length);
        expect(result[0]).toBe(previous[0]);
        expect(result[1]).toBe(previous[1]);
        expect(result[2]).not.toBe(previous[2]);
        expect(result[2]).toEqual({id: 5});
    });

    test('a reorder of content-equal rows: the conscious positional behavior', () => {
        const previous = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
        // Content-equal copies in reversed order, like a detached live read of a sorted store.
        const live = [{id: 'c'}, {id: 'b'}, {id: 'a'}];

        const result = reconcileSelection<typeof previous>(previous, live);

        // The positional comparator has no notion of "moved": content differs at every index,
        // so the array counts as changed and the result carries the LIVE order.
        expect(result).not.toBe(previous);
        expect(result).toEqual([{id: 'c'}, {id: 'b'}, {id: 'a'}]);
        expect(result).toHaveLength(3);
        // Nothing is moved: the untouched middle slot is reused, the displaced slots are
        // fresh copies, never the previous-side object at either its old or new index.
        expect(result[0]).not.toBe(previous[0]);
        expect(result[0]).not.toBe(previous[2]);
        expect(result[1]).toBe(previous[1]);
        expect(result[2]).not.toBe(previous[2]);
        expect(result[2]).not.toBe(previous[0]);
    });

    test('an alias introduced between two previous branches collapses onto one result member', () => {
        const x = {v: 1};
        const y = {v: 2};
        const z = {v: 3};
        const previous = {a: x, b: y};
        const live = {a: z, b: z};

        const result = reconcileSelection<{a: object; b: object}>(previous, live);

        expect(result.a).toBe(result.b);
        expect(result.a).not.toBe(previous.a);
        expect(result.b).not.toBe(previous.b);
    });

    test('an alias removed splits into distinct result members', () => {
        const x = {v: 1};
        const previous = {a: x, b: x};
        const live = {a: {v: 1}, b: {v: 1}};

        const result = reconcileSelection<{a: object; b: object}>(previous, live);

        expect(result).not.toBe(previous);
        expect(result.a).not.toBe(result.b);
        // The first branch is content-equal and reuses the previous leaf; the split second
        // branch must be a fresh copy, not the aliased previous object.
        expect(result.a).toBe(x);
        expect(result.b).not.toBe(x);
    });

    test('one live raw maps to exactly one result copy across all its aliases', () => {
        const x = {v: 1};
        const previous = {c: {ref: x}, a: x, b: x, flag: 0};
        const z = {v: 2};
        const live = {c: {ref: z}, a: z, b: z, flag: 1};

        const result = reconcileSelection<{a: object; b: object; c: {ref: object}; flag: number}>(
            previous,
            live
        );

        expect(result.flag).toEqual(1);
        expect(result.a).toBe(result.b);
        expect(result.c.ref).toBe(result.a);
        expect(result.a).not.toBe(x);
    });

    test('a finished pair revisited under an unchanged wrapper hands out its own verdict', () => {
        // Same topology as the test above but with the aliased members walked FIRST: the x<->z
        // pair is resolved to a copy for a/b, then c's walk hits `previousToFresh(x) === z` as a
        // FINISHED pair: it must return the fresh copy, not the previous leaf — otherwise c's
        // wrapper ends "unchanged" and the stale x leaks into the new snapshot.
        const x = {v: 1};
        const previous = {a: x, b: x, c: {ref: x}};
        const z = {v: 2};
        const live = {a: z, b: z, c: {ref: z}};

        const result = reconcileSelection<{a: object; b: object; c: {ref: object}}>(previous, live);

        expect(result.c.ref).toEqual({v: 2});
        expect(result.a).toEqual({v: 2});
        expect(result.b).toEqual({v: 2});
        // One raw, one copy: every alias lands on the same member.
        expect(result.a).toBe(result.b);
        expect(result.c.ref).toBe(result.a);

        // Key order must not matter: the aliased members walked after the wrapper resolve the
        // same way.
        const previousReordered = {c: {ref: x}, a: x, b: x};
        const liveReordered = {c: {ref: z}, a: z, b: z};

        const reordered = reconcileSelection<{a: object; b: object; c: {ref: object}}>(
            previousReordered,
            liveReordered
        );

        expect(reordered.c.ref).toEqual({v: 2});
        expect(reordered.a).toEqual({v: 2});
        expect(reordered.b).toEqual({v: 2});
        expect(reordered.a).toBe(reordered.b);
    });

    test('an unchanged cycle keeps the previous object; a changed cycle heals onto the new shape', () => {
        const previous: {name: string; self: unknown} = {name: 'a', self: undefined as unknown};
        previous.self = previous;
        const live: {name: string; self: unknown} = {name: 'a', self: undefined as unknown};
        live.self = live;

        const unchanged = reconcileSelection<typeof previous>(previous, live);
        expect(unchanged).toBe(previous);
        expect(unchanged.self).toBe(unchanged);

        const changedLive: {name: string; self: unknown} = {name: 'b', self: undefined as unknown};
        changedLive.self = changedLive;

        const changed = reconcileSelection<typeof previous>(previous, changedLive);
        expect(changed).not.toBe(previous);
        expect(changed.self).toBe(changed);
        expect(changed.name).toEqual('b');
    });

    test('Dates compare by time: changed time is a new Date, equal time and Invalid Date are reused', () => {
        const previousChanged = {stamp: new Date(1)};
        const changed = reconcileSelection<{stamp: Date}>(previousChanged, {stamp: new Date(2)});
        expect(changed.stamp).not.toBe(previousChanged.stamp);
        expect(changed.stamp.getTime()).toEqual(2);

        const previousSame = {stamp: new Date(1)};
        expect(reconcileSelection(previousSame, {stamp: new Date(1)})).toBe(previousSame);

        const previousInvalid = {stamp: new Date(NaN)};
        expect(reconcileSelection(previousInvalid, {stamp: new Date(NaN)})).toBe(previousInvalid);
    });

    test('Maps: unchanged hands back previous; a value change copies the Map, object keys count as changed', () => {
        const obj = {v: 1};
        const previous = new Map<string, object>([['k', obj], ['j', {w: 1}]]);

        expect(reconcileSelection(previous, new Map<string, object>([['k', obj], ['j', {w: 1}]]))).toBe(previous);

        const changed = reconcileSelection<Map<string, object>>(
            previous,
            new Map<string, object>([['k', {v: 2}], ['j', {w: 1}]])
        );
        expect(changed).not.toBe(previous);
        expect(changed.get('k')).toEqual({v: 2});
        // The untouched object-valued entry is reused where possible.
        expect(changed.get('k')).not.toBe(previous.get('k'));
        expect(changed.get('j')).toBe(previous.get('j'));

        // An object key cannot be matched across copies: conservatively changed.
        const objectKeyPrevious = new Map<object, number>([[obj, 1]]);
        const objectKeyResult = reconcileSelection<Map<object, number>>(
            objectKeyPrevious,
            new Map<object, number>([[{v: 1}, 1]])
        );
        expect(objectKeyResult).not.toBe(objectKeyPrevious);
        expect(objectKeyResult.size).toEqual(1);
    });

    test('Sets: unchanged hands back previous; an addition yields a new Set with the full membership', () => {
        const previous = new Set<string>(['a', 'b']);

        expect(reconcileSelection(previous, new Set<string>(['a', 'b']))).toBe(previous);

        const grown = reconcileSelection<Set<string>>(previous, new Set<string>(['a', 'b', 'c']));
        expect(grown).not.toBe(previous);
        expect(Array.from(grown)).toEqual(['a', 'b', 'c']);
    });

    test('a class instance stays live, is reported, and a throwing report propagates', () => {
        const live = new Instance(1);
        const seen: object[] = [];

        const result = reconcileSelection<{i: Instance}>({i: new Instance(0)}, {i: live}, (instance: object): void => {
            seen.push(instance);
        });
        // The wrapper is a fresh copy, but the instance itself stays live.
        expect(result.i).toBe(live);
        expect(seen).toEqual([live]);

        expect(() =>
            reconcileSelection({i: new Instance(0)}, {i: live}, (): never => {
                throw new Error('hook/watch policy rejects live instances');
            })
        ).toThrow('hook/watch policy rejects live instances');
    });

    test('an Array subclass is rejected through the guard and stays live without one', () => {
        const live = new RowList(1, 2, 3);

        expect(() =>
            reconcileSelection([1, 2, 3], live, undefined, rejectAll)
        ).toThrow('rejected: RowList');

        expect(reconcileSelection([1, 2, 3], live)).toBe(live);
    });

    test('sparse arrays keep their holes and catch a change behind one', () => {
        const previous: number[] = [0];
        previous[2] = 2; // [0, <1 empty>, 2]

        const clone: number[] = [0];
        clone[2] = 2;
        const unchanged = reconcileSelection<number[]>(previous, clone);
        expect(unchanged).toBe(previous);

        const live: number[] = [0];
        live[2] = 5;
        const result = reconcileSelection<number[]>(previous, live);

        expect(result).not.toBe(previous);
        expect(result).toHaveLength(3);
        expect(Object.prototype.hasOwnProperty.call(result, 1)).toBe(false);
        expect(result[0]).toEqual(0);
        expect(result[2]).toEqual(5);
    });

    test('an own `__proto__` key survives as an own key and null prototypes are preserved or detected', () => {
        // An own enumerable key literally named `__proto__` (a bracket assignment would hit the
        // setter and change the prototype instead, so define it explicitly).
        const makeProtoKeyed = (v: number): Record<string, unknown> => {
            const keyed: Record<string, unknown> = {tail: 1};
            Object.defineProperty(keyed, '__proto__',
                {value: {v}, enumerable: true, writable: true, configurable: true});
            return keyed;
        };
        const previous = makeProtoKeyed(1);
        const live = makeProtoKeyed(1);

        expect(reconcileSelection(previous, live)).toBe(previous);

        const changed = reconcileSelection<Record<string, unknown>>(previous, makeProtoKeyed(2));
        expect(changed).not.toBe(previous);
        expect(Object.getOwnPropertyDescriptor(changed, '__proto__')).toBeDefined();
        expect(ownProtoKey(changed)).toEqual({v: 2});
        expect(Object.getPrototypeOf(changed)).toBe(Object.prototype);

        const makeNullDict = (a: number): Record<string, number> =>
            Object.assign(Object.create(null), {a});

        const nullPrevious = makeNullDict(1);
        expect(reconcileSelection(nullPrevious, makeNullDict(1))).toBe(nullPrevious);

        const nullChanged = reconcileSelection<Record<string, number>>(nullPrevious, makeNullDict(2));
        expect(nullChanged).not.toBe(nullPrevious);
        expect(Object.getPrototypeOf(nullChanged)).toBe(null);
        expect(nullChanged.a).toEqual(2);

        // A prototype change (plain -> null-proto, same content) is a new shape, not a reuse.
        const plain = {a: 1};
        const reprototyped = reconcileSelection<Record<string, number>>(plain, makeNullDict(1));
        expect(reprototyped).not.toBe(plain);
        expect(Object.getPrototypeOf(reprototyped)).toBe(null);
    });

    test('pair maps: one previous behind two fresh raws yields distinct result members', () => {
        const x = {v: 1};
        const previous = {a: x, b: x};
        const live = {a: {v: 1}, b: {v: 1}};

        const result = reconcileSelection<{a: object; b: object}>(previous, live);

        expect(result.a).not.toBe(result.b);
        expect(result.a).toEqual({v: 1});
        expect(result.b).toEqual({v: 1});
    });
});
