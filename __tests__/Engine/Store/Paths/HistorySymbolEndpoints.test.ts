import {Carburetor, CarburetorHistory} from '@/Carburetor';
import {IWritePatch} from '@/Carburetor/Models/Paths';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';
import {installPatch} from '@/Carburetor/Store/Paths/Diff/installPatch';

const marker = Symbol.for('react-carburetor/v1/patch-absent');
const ordinary = Symbol('consumer-state');

class SymbolStore<T extends object> extends Carburetor<T> {
    public edit(mutate: (draft: T) => void): void {
        this.update(mutate);
    }
}

describe('history patch endpoints preserve legal symbol payloads', () => {
    test.each([marker, ordinary, undefined])('replaces an own value in both directions: %s', value => {
        const store = new SymbolStore<{k: symbol | number | undefined}>({k: 0});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.k = value; });
        expect(Object.hasOwn(store.getData(), 'k')).toBe(true);
        expect(store.getData().k).toBe(value);
        expect(history.undo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(true);
        expect(store.getData().k).toBe(0);
        expect(history.redo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(true);
        expect(store.getData().k).toBe(value);
        history.disconnect();

        const reverse = new SymbolStore<{k: symbol | number | undefined}>({k: value});
        const reverseHistory = new CarburetorHistory(reverse);
        reverse.edit(draft => { draft.k = 7; });
        expect(reverseHistory.undo()).toBe(true);
        expect(Object.hasOwn(reverse.getData(), 'k')).toBe(true);
        expect(reverse.getData().k).toBe(value);
        expect(reverseHistory.redo()).toBe(true);
        expect(Object.hasOwn(reverse.getData(), 'k')).toBe(true);
        expect(reverse.getData().k).toBe(7);
        reverseHistory.disconnect();
    });

    test.each([marker, undefined])('adds and deletes an own value without confusing absence: %s', value => {
        const store = new SymbolStore<Record<string, unknown>>({});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.k = value; });
        expect(Object.hasOwn(store.getData(), 'k')).toBe(true);
        expect(store.getData().k).toBe(value);
        expect(history.undo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(false);
        expect(history.redo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(true);
        expect(store.getData().k).toBe(value);
        store.edit(draft => { delete draft.k; });
        expect(Object.hasOwn(store.getData(), 'k')).toBe(false);
        expect(history.undo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(true);
        expect(store.getData().k).toBe(value);
        expect(history.redo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(false);
        history.disconnect();
    });

    test('defineProperty preserves the marker as an own value through replay', () => {
        const store = new SymbolStore<Record<string, unknown>>({});
        const history = new CarburetorHistory(store);
        store.edit(draft => {
            Object.defineProperty(draft, 'k', {
                value: marker, enumerable: true, configurable: true, writable: true,
            });
        });
        expect(store.getData().k).toBe(marker);
        expect(history.undo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(false);
        expect(history.redo()).toBe(true);
        expect(Object.hasOwn(store.getData(), 'k')).toBe(true);
        expect(store.getData().k).toBe(marker);
        history.disconnect();
    });

    test('array truncation restores present symbol, own undefined, holes, and length', () => {
        const items: (symbol | number | undefined)[] = [0, marker, undefined];
        items.length = 5;
        items[4] = ordinary;
        const store = new SymbolStore({items});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.items.length = 1; });
        expect(store.getData().items).toEqual([0]);
        expect(history.undo()).toBe(true);
        expect(store.getData().items.length).toBe(5);
        expect(Object.keys(store.getData().items)).toEqual(['0', '1', '2', '4']);
        expect(store.getData().items[1]).toBe(marker);
        expect(store.getData().items[2]).toBeUndefined();
        expect(store.getData().items[4]).toBe(ordinary);
        expect(history.redo()).toBe(true);
        expect(store.getData().items).toEqual([0]);
        history.disconnect();
    });

    test('same-kind branch replacement preserves null prototype, literal dotted keys and own presence', () => {
        const before = Object.assign(Object.create(null) as Record<string, unknown>, {
            'a.b': marker, absent: undefined,
        });
        const after = Object.assign(Object.create(null) as Record<string, unknown>, {
            'a.b': ordinary, newKey: marker,
        });
        const store = new SymbolStore({branch: before});
        const history = new CarburetorHistory(store);
        store.edit(draft => { draft.branch = after; });
        expect(history.undo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().branch)).toBeNull();
        expect(store.getData().branch['a.b']).toBe(marker);
        expect(Object.hasOwn(store.getData().branch, 'absent')).toBe(true);
        expect(Object.hasOwn(store.getData().branch, 'newKey')).toBe(false);
        expect(history.redo()).toBe(true);
        expect(Object.getPrototypeOf(store.getData().branch)).toBeNull();
        expect(store.getData().branch['a.b']).toBe(ordinary);
        expect(store.getData().branch.newKey).toBe(marker);
        expect(Object.hasOwn(store.getData().branch, 'absent')).toBe(false);
        history.disconnect();
    });

    test('root setData diff restores symbol payloads and own presence', () => {
        const store = new SymbolStore<Record<string, unknown>>({k: marker, present: undefined});
        const history = new CarburetorHistory(store);
        store.setData({k: ordinary, added: marker});
        expect(history.undo()).toBe(true);
        expect(store.getData().k).toBe(marker);
        expect(Object.hasOwn(store.getData(), 'present')).toBe(true);
        expect(Object.hasOwn(store.getData(), 'added')).toBe(false);
        expect(history.redo()).toBe(true);
        expect(store.getData().k).toBe(ordinary);
        expect(store.getData().added).toBe(marker);
        expect(Object.hasOwn(store.getData(), 'present')).toBe(false);
        history.disconnect();
    });
});

test('leaf diff patches distinguish own undefined, symbols and missing keys on a null-prototype branch', () => {
    const before = Object.assign(Object.create(null) as Record<string, unknown>, {
        'a.b': marker, gone: undefined,
    });
    const after = Object.assign(Object.create(null) as Record<string, unknown>, {
        'a.b': ordinary, added: marker,
    });
    const patches: IWritePatch[] = [];
    diffPaths(before, after, '', [], patch => {
        if (typeof patch !== 'symbol') patches.push(patch);
    });
    expect(patches).toEqual([
        {segments: ['a.b'], previousExists: true, previous: marker, nextExists: true, next: ordinary},
        {segments: ['gone'], previousExists: true, previous: undefined, nextExists: false, next: undefined},
        {segments: ['added'], previousExists: false, previous: undefined, nextExists: true, next: marker},
    ]);
    const replay = Object.assign(Object.create(null) as Record<string, unknown>, before);
    for (const patch of patches) installPatch(replay, patch, false);
    expect(Object.keys(replay)).toEqual(Object.keys(after));
    expect(replay['a.b']).toBe(ordinary);
    expect(replay.added).toBe(marker);
    for (const patch of [...patches].reverse()) installPatch(replay, patch, true);
    expect(Object.keys(replay)).toEqual(Object.keys(before));
    expect(replay['a.b']).toBe(marker);
    expect(Object.hasOwn(replay, 'gone')).toBe(true);
});
