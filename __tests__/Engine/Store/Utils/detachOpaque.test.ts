import {detachOpaque} from "@/Carburetor/Store/Utils/Selection/detachOpaque";

class Instance {
    public n: number;

    public constructor(n: number) {
        this.n = n;
    }
}

class TaggedMap extends Map<string, number> {
    #tag: string;

    public constructor(tag: string, entries: [string, number][]) {
        super(entries);
        this.#tag = tag;
    }

    public tag(): string {
        return this.#tag;
    }
}

class TaggedSet extends Set<string> {
    #tag: string;

    public constructor(tag: string, members: string[]) {
        super(members);
        this.#tag = tag;
    }

    public tag(): string {
        return this.#tag;
    }
}

class TaggedDate extends Date {
    #tag: string;

    public constructor(tag: string, time: number) {
        super(time);
        this.#tag = tag;
    }

    public tag(): string {
        return this.#tag;
    }
}

describe('detachOpaque', () => {
    test('primitives and functions pass through unchanged', () => {
        const fn = (): void => undefined;

        expect(detachOpaque(1)).toEqual(1);
        expect(detachOpaque('a')).toEqual('a');
        expect(detachOpaque(null)).toEqual(null);
        expect(detachOpaque(undefined)).toEqual(undefined);
        expect(detachOpaque(fn)).toBe(fn);
    });

    test('Map, Set and Date members are detached at any depth inside plain containers (R7-01)', () => {
        const date = new Date(1000);
        const map = new Map([['a', 1]]);
        const set = new Set(['x']);
        const source = {list: [{map, set, date}]};

        const copy = detachOpaque(source);
        const inner = copy.list[0];

        expect(inner.map).not.toBe(map);
        expect(inner.map.get('a')).toEqual(1);
        expect(inner.set).not.toBe(set);
        expect(inner.date).not.toBe(date);
        expect(inner.date.getTime()).toEqual(1000);
    });

    test('a Map nested inside another Map is detached recursively (R7-01)', () => {
        const inner = new Map([['a', 1]]);
        const outer = new Map([['row', inner]]);

        const copy = detachOpaque(outer);
        const copyInner = copy.get('row');

        expect(copyInner).not.toBe(inner);
        expect(copyInner?.get('a')).toEqual(1);
    });

    test('a plain-object Map key is detached too, so the copy is read through its own keys (R7-01)', () => {
        const key = {id: 1};
        const source = new Map([[key, 'v']]);

        const copy = detachOpaque(source);
        const copyKeys = [...copy.keys()];

        expect(copyKeys[0]).not.toBe(key);
        expect(copyKeys[0].id).toEqual(1);
        expect(copy.get(copyKeys[0])).toEqual('v');
    });

    test('an unrelated Proxy is not treated as an engine read view', () => {
        const raw = {id: 1};
        const externalProxy = new Proxy(raw, {});
        const copy = detachOpaque({index: new Map([[raw, 'answer']]), key: externalProxy});

        expect(copy.index.keys().next().value).not.toBe(copy.key);
        expect(copy.index.get(copy.key)).toBeUndefined();
        expect(copy.index.keys().next().value).not.toBe(raw);
    });

    test.each(['key-first', 'index-first'])('one Date copy serves every path (%s)', order => {
        const date = new Date(1000);
        const index = new Map<unknown, unknown>([[date, date]]);
        const members = new Set([date]);
        const source = order === 'key-first'
            ? {key: date, index, members}
            : {index, members, key: date};
        const copy = detachOpaque(source);
        const mapDate = [...copy.index.keys()][0] as Date;

        expect(copy.key).not.toBe(date);
        expect(mapDate).toBe(copy.key);
        expect(copy.index.get(copy.key)).toBe(copy.key);
        expect([...copy.members][0]).toBe(copy.key);
        copy.key.setTime(2000);
        expect(mapDate.getTime()).toBe(2000);
        expect(date.getTime()).toBe(1000);
    });

    test('a class instance passes through live at any depth and is reported (R7-01)', () => {
        const box = new Instance(1);
        const reported: object[] = [];
        const source = {box, list: [box]};

        const copy = detachOpaque(source, (instance: object) => reported.push(instance));

        expect(copy.box).toBe(box);
        expect(copy.list[0]).toBe(box);
        // One report per handover, not per distinct instance: the copy hands the same object
        // over at both depths.
        expect(reported).toEqual([box, box]);
    });

    test('a cycle through plain containers and Maps terminates and reuses the copy', () => {
        const source: Record<string, unknown> = {name: 'root'};
        const map = new Map<unknown, unknown>();

        source.self = source;
        source.map = map;
        map.set('back', source);

        const copy = detachOpaque(source);
        const copyMap = copy.map as Map<unknown, unknown>;

        expect(copy.self).toBe(copy);
        expect(copyMap.get('back')).toBe(copy);
        expect(copy.name).toEqual('root');
    });

    test('null-prototype dictionaries and sparse arrays keep their shape; symbol keys are not part of a selection (R30-04)', () => {
        const tag = Symbol('tag');
        const dictionary: Record<string, unknown> = Object.create(null);

        dictionary.a = 1;

        const sparse: unknown[] = [];

        sparse[2] = 'x';

        const source = {dictionary, tagged: {[tag]: 2}, sparse};

        const copy = detachOpaque(source);

        expect(Object.getPrototypeOf(copy.dictionary)).toBeNull();
        expect(Object.keys(copy.tagged)).toEqual([]);
        expect(copy.sparse.length).toEqual(3);
        expect(Object.keys(copy.sparse)).toEqual(['2']);
        expect(0 in copy.sparse).toEqual(false);
    });

    test('non-enumerable keys are not part of a selection (R30-04)', () => {
        const box = new Instance(2);
        const source = {};

        Object.defineProperty(source, 'hidden', {
            value: box,
            writable: false,
            enumerable: false,
            configurable: true,
        });

        const copy = detachOpaque(source, (_instance: object) => []);

        expect(Object.keys(copy)).toEqual([]);
        expect(Object.getOwnPropertySymbols(copy)).toEqual([]);
    });

    test('a Map/Set/Date subclass passes through live and is reported, not rebuilt as the base class (R12-02)', () => {
        const taggedMap = new TaggedMap('m', [['a', 1]]);
        const taggedSet = new TaggedSet('s', ['x']);
        const taggedDate = new TaggedDate('d', 1000);
        const reported: object[] = [];

        const source = {taggedMap, taggedSet, taggedDate};
        const copy = detachOpaque(source, (instance: object) => reported.push(instance));

        expect(copy.taggedMap).toBe(taggedMap);
        expect(copy.taggedSet).toBe(taggedSet);
        expect(copy.taggedDate).toBe(taggedDate);
        expect((copy.taggedMap as TaggedMap).tag()).toEqual('m');
        expect((copy.taggedSet as TaggedSet).tag()).toEqual('s');
        expect((copy.taggedDate as TaggedDate).tag()).toEqual('d');
        expect(reported).toEqual([taggedMap, taggedSet, taggedDate]);
    });

    test('a nested Map subclass member is also passed through live, not silently downgraded (R12-02)', () => {
        const taggedMap = new TaggedMap('inner', [['a', 1]]);
        const reported: object[] = [];

        const copy = detachOpaque({list: [{taggedMap}]}, (instance: object) => reported.push(instance));

        expect(copy.list[0].taggedMap).toBe(taggedMap);
        expect(reported).toEqual([taggedMap]);
    });

    test('plain Map, Set and Date are still copied and detached (control for R12-02)', () => {
        const map = new Map([['a', 1]]);
        const set = new Set(['x']);
        const date = new Date(1000);

        const copy = detachOpaque({map, set, date});

        expect(copy.map).not.toBe(map);
        expect(copy.map.get('a')).toEqual(1);
        expect(copy.set).not.toBe(set);
        expect(copy.set.has('x')).toEqual(true);
        expect(copy.date).not.toBe(date);
        expect(copy.date.getTime()).toEqual(1000);
    });

    test('native own fields on a Map/Set/Date are not part of a selection (R30-04)', () => {
        const key = {id: 1};
        const map = new Map<object, unknown>([[key, 'answer']]);
        const set = new Set<object>([key]);
        const date = new Date(1000);
        const symbol = Symbol('native-field');

        Object.defineProperty(map, 'hidden', {
            value: {key}, enumerable: false, writable: false, configurable: false
        });
        Object.defineProperty(set, symbol, {
            value: date, enumerable: true, writable: true, configurable: true
        });

        const copy = detachOpaque({key, map, set, date});
        const copiedMap = copy.map;

        expect([...copiedMap.keys()][0]).toBe(copy.key);
        expect(copiedMap.get(copy.key)).toBe('answer');
        expect([...copy.set][0]).toBe(copy.key);
        expect(Object.getOwnPropertyDescriptor(copiedMap, 'hidden')).toBeUndefined();
        expect(Object.getOwnPropertyDescriptor(copy.set, symbol)).toBeUndefined();
        expect(Object.getOwnPropertyDescriptor(copy.date, 'hidden')).toBeUndefined();

        copiedMap.set(copy.key, 'changed');
        expect(map.get(key)).toBe('answer');
    });

    test('an own accessor on a plain object is read once and its value is the snapshot (R30-04)', () => {
        let getterCalls = 0;
        const getter = (): number => {
            getterCalls++;

            return 7;
        };
        const source = {};

        Object.defineProperty(source, 'answer', {get: getter, enumerable: true, configurable: true});

        const copy = detachOpaque(source) as {answer: number};

        expect(copy.answer).toEqual(7);
        expect(getterCalls).toEqual(1);
    });

    test('every getter runs once when a container field follows primitive fields (R30-G)', () => {
        const calls = {title: 0, payload: 0, tail: 0};
        const source = {};

        Object.defineProperty(source, 'title', {
            get: () => (calls.title++, 'a'), enumerable: true, configurable: true
        });
        Object.defineProperty(source, 'payload', {
            get: () => (calls.payload++, {n: 1}), enumerable: true, configurable: true
        });
        Object.defineProperty(source, 'tail', {
            get: () => (calls.tail++, 2), enumerable: true, configurable: true
        });

        const copy = detachOpaque(source) as {title: string; payload: {n: number}; tail: number};

        expect(copy).toEqual({title: 'a', payload: {n: 1}, tail: 2});
        expect(calls).toEqual({title: 1, payload: 1, tail: 1});
    });

    test('a cycle through the root survives the primitive-first path (R30-G)', () => {
        const root: {name: string; self?: unknown} = {name: 'r'};

        root.self = root;

        const copy = detachOpaque(root) as {name: string; self: unknown};

        expect(copy).not.toBe(root);
        expect(copy.self).toBe(copy);
    });

    test.each(['Map', 'Set', 'Date'] as const)(
        '%s native contents survive with an own method-name data field', kind => {
        const native = kind === 'Map' ? new Map([['a', 1]])
            : kind === 'Set' ? new Set(['a']) : new Date(1000);
        const method = kind === 'Date' ? 'getTime' : 'forEach';
        Object.defineProperty(native, method, {
            value: {native}, enumerable: false, writable: false, configurable: false
        });

        const copy = detachOpaque(native);

        expect(copy).not.toBe(native);
        // Own fields are not part of a selection, but the intrinsic content is copied.
        if (copy instanceof Map) {
            expect(Map.prototype.get.call(copy, 'a')).toBe(1);
        } else if (copy instanceof Set) {
            expect(Set.prototype.has.call(copy, 'a')).toBe(true);
        } else {
            expect(Date.prototype.getTime.call(copy)).toBe(1000);
        }
    });

    test('an own key named __proto__ lands as data on the copy', () => {
        const source: Record<string, unknown> = {v: 1};

        Object.defineProperty(source, '__proto__', {
            value: {v: 2}, enumerable: true, writable: true, configurable: true
        });

        const copy = detachOpaque(source) as Record<string, unknown>;

        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect((copy.__proto__ as {v: number}).v).toEqual(2);
    });
});
