import {detachOpaque} from "@/Carburetor/Store/Utils/detachOpaque";

class Instance {
    public n: number;

    public constructor(n: number) {
        this.n = n;
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

    test('accessor descriptors are rejected without invoking their getter', () => {
        let getterCalls = 0;
        const getter = (): number => {
            getterCalls++;

            return 7;
        };
        const source = {};

        Object.defineProperty(source, 'hidden', {get: getter, enumerable: false});

        expect(() => detachOpaque(source)).toThrow('cannot snapshot accessor property hidden');
        expect(getterCalls).toEqual(0);
    });
});
