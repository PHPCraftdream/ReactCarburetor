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

    test('plain-container guarantees survive: null-prototype dictionaries, symbol keys, sparse arrays', () => {
        const tag = Symbol('tag');
        const dictionary: Record<string, unknown> = Object.create(null);

        dictionary.a = 1;

        const sparse: unknown[] = [];

        sparse[2] = 'x';

        const source = {dictionary, tagged: {[tag]: 2}, sparse};

        const copy = detachOpaque(source);

        expect(Object.getPrototypeOf(copy.dictionary)).toBeNull();
        expect(Object.getOwnPropertySymbols(copy.tagged)).toEqual([tag]);
        expect(copy.sparse.length).toEqual(3);
        expect(Object.keys(copy.sparse)).toEqual(['2']);
        expect(0 in copy.sparse).toEqual(false);
    });

    test('non-enumerable data descriptors are detached with their flags preserved', () => {
        const box = new Instance(2);
        const source = {};
        const reported: object[] = [];

        Object.defineProperty(source, 'hidden', {
            value: box,
            writable: false,
            enumerable: false,
            configurable: true,
        });

        const copy = detachOpaque(source, (instance: object) => reported.push(instance));
        const sourceDescriptor = Object.getOwnPropertyDescriptor(source, 'hidden');
        const copyDescriptor = Object.getOwnPropertyDescriptor(copy, 'hidden');

        expect(copyDescriptor?.value).toBe(box);
        expect(copyDescriptor?.enumerable).toEqual(false);
        expect(copyDescriptor?.writable).toEqual(false);
        expect(copyDescriptor?.configurable).toEqual(true);
        expect(reported).toEqual([box]);
        expect(sourceDescriptor?.value).toBe(box);
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

    test('native own fields preserve flags and links to contents and other native copies', () => {
        const key = {id: 1};
        const map = new Map<object, unknown>([[key, 'answer']]);
        const set = new Set<object>([key, map]);
        const date = new Date(1000);
        const symbol = Symbol('native-field');

        Object.defineProperty(map, 'hidden', {
            value: {key, map, set, date}, enumerable: false, writable: false, configurable: false
        });
        Object.defineProperty(map, symbol, {
            value: set, enumerable: true, writable: true, configurable: true
        });
        Object.defineProperty(set, 'hidden', {
            value: {key, map, set}, enumerable: false, writable: false, configurable: false
        });
        Object.defineProperty(set, symbol, {
            value: date, enumerable: true, writable: true, configurable: true
        });
        Object.defineProperty(date, 'hidden', {
            value: {key, map, date}, enumerable: false, writable: false, configurable: false
        });
        Object.defineProperty(date, symbol, {
            value: {set, date}, enumerable: true, writable: true, configurable: true
        });

        const copy = detachOpaque({key, map, set, date});
        const copiedMap = copy.map;
        const mapLinks = Object.getOwnPropertyDescriptor(copiedMap, 'hidden')?.value as
            {key: object; map: object; set: object; date: object};
        const setLinks = Object.getOwnPropertyDescriptor(copy.set, 'hidden')?.value as
            {key: object; map: object; set: object};
        const dateLinks = Object.getOwnPropertyDescriptor(copy.date, 'hidden')?.value as
            {key: object; map: object; date: object};

        expect([...copiedMap.keys()][0]).toBe(copy.key);
        expect(copiedMap.get(copy.key)).toBe('answer');
        const setMembers = [...copy.set];
        expect(setMembers[0]).toBe(copy.key);
        expect(setMembers[1]).toBe(copiedMap);
        expect(mapLinks.key).toBe(copy.key);
        expect(mapLinks.map).toBe(copiedMap);
        expect(mapLinks.set).toBe(copy.set);
        expect(mapLinks.date).toBe(copy.date);
        expect(setLinks.key).toBe(copy.key);
        expect(setLinks.map).toBe(copiedMap);
        expect(setLinks.set).toBe(copy.set);
        expect(dateLinks.key).toBe(copy.key);
        expect(dateLinks.map).toBe(copiedMap);
        expect(dateLinks.date).toBe(copy.date);
        expect(Object.getOwnPropertyDescriptor(copiedMap, symbol)?.value).toBe(copy.set);
        expect(Object.getOwnPropertyDescriptor(copy.set, symbol)?.value).toBe(copy.date);
        const dateSymbol = Object.getOwnPropertyDescriptor(copy.date, symbol)?.value as {set: object; date: object};
        expect(dateSymbol.set).toBe(copy.set);
        expect(dateSymbol.date).toBe(copy.date);

        for (const [source, detached] of [[map, copy.map], [set, copy.set], [date, copy.date]]) {
            expect(detached).not.toBe(source);
            for (const field of ['hidden', symbol]) {
                const original = Object.getOwnPropertyDescriptor(source, field);
                const result = Object.getOwnPropertyDescriptor(detached, field);
                expect(result).toBeDefined();
                expect(result?.enumerable).toBe(original?.enumerable);
                expect(result?.writable).toBe(original?.writable);
                expect(result?.configurable).toBe(original?.configurable);
                expect(result?.value).not.toBe(original?.value);
            }
        }

        copiedMap.set(copy.key, 'changed');
        expect(map.get(key)).toBe('answer');
    });

    test.each(['Map', 'Set', 'Date'] as const)('%s own accessors are rejected without invoking getters', kind => {
        const native = kind === 'Map' ? new Map([['a', 1]])
            : kind === 'Set' ? new Set(['a']) : new Date(1000);
        let getterCalls = 0;
        Object.defineProperty(native, Symbol('accessor'), {
            get(): string {
                getterCalls++;
                return 'unsafe';
            }
        });

        expect(() => detachOpaque({native})).toThrow(Error);
        expect(getterCalls).toBe(0);
    });

    test.each(['Map', 'Set', 'Date'] as const)('%s rejects an own getter shadowing native copying', kind => {
        const native = kind === 'Map' ? new Map([['a', 1]])
            : kind === 'Set' ? new Set(['a']) : new Date(1000);
        const method = kind === 'Date' ? 'getTime' : 'forEach';
        let getterCalls = 0;
        Object.defineProperty(native, method, {
            get(): () => void {
                getterCalls++;
                return () => { getterCalls++; };
            }
        });

        expect(() => detachOpaque(native)).toThrow(Error);
        expect(getterCalls).toBe(0);
    });

    test.each(['Map', 'Set', 'Date'] as const)('%s keeps native contents with an own method-name data field', kind => {
        const native = kind === 'Map' ? new Map([['a', 1]])
            : kind === 'Set' ? new Set(['a']) : new Date(1000);
        const method = kind === 'Date' ? 'getTime' : 'forEach';
        Object.defineProperty(native, method, {
            value: {native}, enumerable: false, writable: false, configurable: false
        });

        const copy = detachOpaque(native);
        const field = Object.getOwnPropertyDescriptor(copy, method);

        expect(copy).not.toBe(native);
        expect(field?.enumerable).toBe(false);
        expect(field?.writable).toBe(false);
        expect(field?.configurable).toBe(false);
        expect(field?.value.native).toBe(copy);
        expect(field?.value).not.toBe(Object.getOwnPropertyDescriptor(native, method)?.value);

        if (copy instanceof Map) {
            expect(Map.prototype.get.call(copy, 'a')).toBe(1);
        } else if (copy instanceof Set) {
            expect(Set.prototype.has.call(copy, 'a')).toBe(true);
        } else {
            expect(Date.prototype.getTime.call(copy)).toBe(1000);
        }
    });

    test('accessor descriptors are rejected without invoking their getter', () => {
        let getterCalls = 0;
        const getter = (): number => {
            getterCalls++;

            return 7;
        };
        const source = {};

        Object.defineProperty(source, 'hidden', {get: getter, enumerable: false});

        expect(() => detachOpaque(source)).toThrow(Error);
        expect(getterCalls).toEqual(0);
    });
});
