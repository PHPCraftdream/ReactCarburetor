import {Carburetor, diagnostics} from '@/Carburetor';
import {rstest} from '@rstest/core';
import {createProxyCache} from '@/Carburetor/Store/Tracking/Proxy/createProxyCache';
import {isOrdinaryDate} from '@/Carburetor/Store/Tracking/Proxy/Definitions/isOrdinaryDate';
import {PersistentViews} from '@/Carburetor/Store/Tracking/Observation/PersistentViewCache';
import {writeArrayLength} from '@/Carburetor/Store/Tracking/Proxy/Positional/writeArrayLength';
import {runPositional} from '@/Carburetor/Store/Tracking/Proxy/Positional/positionalArrayMethods';
import {createAliasLedger} from '@/Carburetor/Store/Tracking/Aliases/AliasLedger';
import {dateExposureLedger} from '@/Carburetor/Store/Tracking/Proxy/dateExposureLedger';
import {watchSelection} from '@/Carburetor/Store/Tracking/Observation/watchSelection';
import {TReadonly} from '@/Carburetor/Models/Base';
import {PATCH_OPAQUE} from '@/Carburetor/Models/Paths';

class WatchStore extends Carburetor<{active: boolean; left: number; right: number}> {
    change(fn: (draft: {active: boolean; left: number; right: number}) => void): void { this.update(fn); }
}

describe('createProxyCache', () => {
    test('proxy cache distinguishes same branch at a different path', () => {
        const cache = createProxyCache();
        const raw = {};
        const proxy = {};
        cache.set('left', raw, proxy);
        expect(cache.get('left', raw)).toBe(proxy);
        expect(cache.get('right', raw)).toBeUndefined();
        expect(cache.owns('right', raw)).toBe(false);
    });
});

describe('isOrdinaryDate', () => {
    test('rejects invalid receivers and dates with own keys', () => {
        expect(isOrdinaryDate(new Date())).toBe(true);
        const decorated = new Date();
        Object.defineProperty(decorated, 'tag', {value: true});
        expect(isOrdinaryDate(decorated)).toBe(false);
        expect(isOrdinaryDate(Object.create(Date.prototype))).toBe(false);
        expect(isOrdinaryDate(Object.create({}) as Date)).toBe(false);
    });
});

describe('PersistentViews', () => {
    test('bypasses caching when source has no data accessor', () => {
        const views = new PersistentViews();
        let calls = 0;
        const source = {read: (_record: (path: string) => void): TReadonly<{value: number}> => {
            calls++;
            return {value: calls} as TReadonly<{value: number}>;
        }};
        expect(views.view(source, () => {}).value).toBe(1);
        expect(views.view(source, () => {}).value).toBe(2);
        expect(calls).toBe(2);
    });
});

describe('writeArrayLength', () => {
    test('truncates and attributes observable paths', () => {
        const array = ['a', 'b', 'c'];
        const paths: string[] = [];
        const ok = writeArrayLength(
            array, 1, undefined, 'items', ['items'], path => paths.push(path), undefined, undefined
        );
        expect(ok).toBe(true);
        expect(array).toEqual(['a']);
        expect(paths).toEqual(['items.1', 'items.2', 'items.~k', 'items.length']);
    });
});

describe('runPositional', () => {
    test('fill attributes only changed slots and returns receiver', () => {
        const source = [0, 1, 2, 3];
        const receiver = {};
        const paths: string[] = [];
        const host = {
            basePath: 'items', basePathSegments: ['items'], record: (path: string) => paths.push(path),
            aliases: undefined, cache: {nativeAliasRoot: undefined}, patchPort: undefined,
            writtenPath: (key: string) => `items.${key}`, keysMarker: () => 'items.~k'
        } as never;
        expect(runPositional(host, 'fill', receiver, source, [9, 1, 3])).toBe(receiver);
        expect(source).toEqual([0, 9, 9, 3]);
        expect(paths).toEqual(['items.1', 'items.2']);
    });

    test('attributes opaque changes without patches', () => {
        const source = [1, 2];
        const paths: string[] = [];
        const host = {
            basePath: 'items', basePathSegments: ['items'], record: (path: string) => paths.push(path),
            aliases: undefined, cache: {nativeAliasRoot: undefined},
            patchPort: {opaque: true, listener: () => undefined},
            writtenPath: (key: string) => `items.${key}`, keysMarker: () => 'items.~k'
        };
        const listener = rstest.spyOn(host.patchPort, 'listener');
        expect(() => runPositional(host as never, 'fill', {}, source, [7])).not.toThrow();
        expect(source).toEqual([7, 7]);
        expect(paths).toEqual(['items.0', 'items.1']);
        expect(listener).toHaveBeenCalledWith(PATCH_OPAQUE);
    });

    test('attributes partial changes when the native method throws', () => {
        const source = [1, 2];
        const paths: string[] = [];
        const valueOf = () => { source[0] = 9; throw new Error('coercion failed'); };
        const host = {
            basePath: 'items', basePathSegments: ['items'], record: (path: string) => paths.push(path),
            aliases: undefined, cache: {nativeAliasRoot: undefined}, patchPort: undefined,
            writtenPath: (key: string) => `items.${key}`, keysMarker: () => 'items.~k'
        } as never;
        expect(() => runPositional(host, 'fill', {}, source, [3, {valueOf}])).toThrow('coercion failed');
        expect(paths).toContain('items.0');
    });
});

describe('createAliasLedger', () => {
    test('validates state shape and forgets prior objects', () => {
        const ledger = createAliasLedger();
        if (ledger === undefined) return;
        expect(() => ledger.checkKey([], 'extra', 'extra')).toThrow(/not an index/);
        const invalidArray = Array.from({length: 4097});
        Object.assign(invalidArray, {extra: true});
        expect(() => ledger.checkState(invalidArray, 'items')).toThrow(/non-index own key/);
        const value = {};
        ledger.note(value, 'old', {});
        ledger.forget(value);
        const root = {old: value, new: value};
        ledger.note(value, 'old', root);
        ledger.forget(value);
        const report = rstest.spyOn(diagnostics, 'report').mockImplementation(() => {});
        try {
            ledger.note(value, 'new', root);
            expect(report).not.toHaveBeenCalled();
            ledger.checkWrite(value, 'old', root);
            expect(report).toHaveBeenCalledTimes(1);
        } finally {
            report.mockRestore();
        }
    });
});

describe('watchSelection', () => {
    test('follows changing selector reads and notifies changed selection', () => {
        const store = new WatchStore({active: true, left: 1, right: 2});
        const changes: unknown[][] = [];
        const stop = watchSelection(
            store,
            view => view.active ? view.left : view.right,
            (next, previous) => changes.push([next, previous])
        );
        store.change(draft => {
            draft.active = false;
        });
        expect(changes).toEqual([[2, 1]]);
        store.change(draft => { draft.right = 3; });
        expect(changes).toEqual([[2, 1], [3, 2]]);
        store.change(draft => { draft.right = 4; });
        expect(changes).toEqual([[2, 1], [3, 2], [4, 3]]);
        stop();
        store.change(draft => { draft.right = 5; });
        expect(changes).toHaveLength(3);
    });

    test('rejects live class instances as selections', () => {
        const store = new Carburetor({value: 1});
        class LiveSelection { value = 1; }
        const instance = new LiveSelection();
        expect(() => watchSelection(store, () => instance, () => {})).toThrow(
            'watch() cannot select a live LiveSelection instance because in-place changes cannot produce a safe comparison. ' +
            'Select the fields the callback needs, or return a plain object of those fields.'
        );
    });
});

describe('date exposure', () => {
    test('reports exposed mutations', () => {
        const date = new Date(1);
        const source: Record<string, unknown> = {date};
        const port = {listener: () => undefined};
        const paths: string[] = [];
        const root = {};
        const cache = {nativeAliasRoot: undefined};
        const record = (path: string) => paths.push(path);
        dateExposureLedger.expose(port as never, source, 'date', date, root, record, 'date', cache as never);
        date.setTime(2);
        expect(dateExposureLedger.flush(port as never)).toBe(true);
        expect(paths).toContain('date');
        expect(dateExposureLedger.flush(port as never)).toBe(false);
    });
});
