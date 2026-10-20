import {mergeSaved} from '@/Carburetor/Tooling/Persist/MergeSaved';
import {Carburetor, IStorageLike, IPersistOptions, persist} from '@/Carburetor';

class Storage implements IStorageLike {
    public value: string | null = null;
    public getItem = (): string | null => this.value;
    public setItem = (_key: string, value: string): void => { this.value = value; };
    public removeItem = (): void => { this.value = null; };
}

const config = (storage: Storage, extra: Partial<IPersistOptions> = {}): IPersistOptions => ({
    key: 'state', storage, ...extra,
});

interface IData {
    native: unknown;
    instance: unknown;
    rows: unknown;
}

class Model {
    /** @param value - instance state */
    public constructor(public value: number) {}
}

describe('persist schema evolution', () => {
    test('runs 0-to-1-to-2 migrations in order and merges defaults without pruning extras', () => {
        const storage = new Storage();
        storage.value = JSON.stringify({count: 1, extra: true});
        const calls: string[] = [];
        const store = new Carburetor({count: 0, added: 8});
        const stop = persist(store, config(storage, {
            version: 2, migrate: {
                1: state => { calls.push('1'); return {...state as object, count: 2}; },
                2: state => { calls.push('2'); return {...state as object, count: 3}; },
            }, coalesce: false,
        }));
        expect(calls).toEqual(['1', '2']);
        expect(store.getData()).toEqual({count: 3, extra: true, added: 8});
        stop();
    });

    test('a legacy root that happens to hold v and data fields stays legacy data', () => {
        const storage = new Storage();
        storage.value = JSON.stringify({v: 0, data: {x: 7}, keep: 9});
        const store = new Carburetor({v: 0, data: {x: 0}, keep: 0});
        const stop = persist(store, config(storage, {version: 0, coalesce: false}));
        expect(store.getData()).toEqual({v: 0, data: {x: 7}, keep: 9});
        stop();
    });

    test('envelope skips earlier steps and version zero writes an envelope', () => {
        const storage = new Storage();
        storage.value = JSON.stringify({__carburetorVersion: 1, data: {x: 4}});
        const called: number[] = [];
        const store = new Carburetor({x: 0});
        const stop = persist(store, config(storage, {
            version: 2, migrate: {
                1: state => { called.push(1); return state; },
                2: state => { called.push(2); return state; },
            }, coalesce: false,
        }));
        expect(called).toEqual([2]);
        expect(store.getData()).toEqual({x: 4});
        stop();
        storage.value = null;
        const zeroStore = new Carburetor({x: 0});
        const zeroStop = persist(zeroStore, config(storage, {version: 0, migrate: {}, coalesce: false}));
        zeroStore.setData({x: 5});
        expect(JSON.parse(storage.value as string)).toEqual({__carburetorVersion: 0, data: {x: 5}});
        zeroStop();
    });

    test('versioned writes use an envelope', () => {
        const storage = new Storage();
        const store = new Carburetor({x: 0});
        const stop = persist(store, config(storage, {version: 2, migrate: {1: x => x, 2: x => x}, coalesce: false}));
        store.setData({x: 4});
        expect(JSON.parse(storage.value as string)).toEqual({__carburetorVersion: 2, data: {x: 4}});
        stop();
    });

    test('future versions retain bytes and block later writes and disposal', () => {
        const storage = new Storage();
        storage.value = '{"__carburetorVersion":9,"data":{"x":1}}';
        const original = storage.value;
        const errors: unknown[] = [];
        const store = new Carburetor({x: 0});
        const stop = persist(store, config(storage, {
            version: 2, migrate: {1: x => x, 2: x => x}, onError: error => errors.push(error),
        }));
        expect(store.getData()).toEqual({x: 0});
        store.setData({x: 2});
        stop();
        expect(storage.value).toBe(original);
        expect(errors).toHaveLength(1);
    });

    test('future version without handler throws and retains bytes', () => {
        const storage = new Storage();
        storage.value = '{"__carburetorVersion":9,"data":{"x":1}}';
        const original = storage.value;
        expect(() => persist(new Carburetor({x: 0}), config(storage, {
            version: 2, migrate: {1: x => x, 2: x => x},
        }))).toThrow();
        expect(storage.value).toBe(original);
    });

    test('rejects invalid versions and incomplete configuration synchronously', () => {
        [-1, 1.5, NaN, Infinity].forEach(version => expect(() => persist(
            new Carburetor({x: 0}), config(new Storage(), {version, migrate: {}})
        )).toThrow());
        expect(() => persist(new Carburetor({x: 0}), config(new Storage(), {migrate: {}}))).toThrow();
        expect(() => persist(new Carburetor({x: 0}), config(new Storage(), {version: 2, migrate: {2: x => x}})))
            .toThrow();
        expect(() => persist(new Carburetor({x: 0}), config(new Storage(), {
            version: 0, migrate: {}, partitions: ['x'],
        }))).toThrow();
        expect(() => persist(new Carburetor({x: 0}), config(new Storage(), {prune: true, partitions: ['x']})))
            .toThrow();
    });

    test('migration without an error handler throws and leaves stored bytes unchanged', () => {
        const storage = new Storage();
        storage.value = '{"__carburetorVersion":0,"data":{"x":1}}';
        const original = storage.value;
        expect(() => persist(new Carburetor({x: 0}), config(storage, {
            version: 1, migrate: {1: () => { throw new Error('migration failed'); }},
        }))).toThrow('migration failed');
        expect(storage.value).toBe(original);
    });

    test('migration and callback errors preserve bytes and block writes', () => {
        const failure = new Error('failed');
        [
            {version: 1, migrate: {1: () => { throw failure; }}},
            {version: 0, migrate: {}, prune: () => { throw failure; }},
        ].forEach(extra => {
            const storage = new Storage();
            storage.value = '{"__carburetorVersion":0,"data":{"x":1}}';
            const original = storage.value;
            const errors: unknown[] = [];
            const store = new Carburetor({x: 0});
            const stop = persist(store, config(storage, {
                ...extra, onError: error => errors.push(error),
            }));
            store.setData({x: 3});
            stop();
            expect(storage.value).toBe(original);
            expect(errors).toEqual([failure]);
        });
    });

    test('prunes only when true, merges defaults, and calls callbacks with wire data even versioned', () => {
        const storage = new Storage();
        storage.value = JSON.stringify({nested: {keep: 1, stale: true}, dict: {arbitrary: 2}});
        const store = new Carburetor({nested: {keep: 0, add: 3}, dict: {}});
        const stop = persist(store, config(storage, {prune: true}));
        expect(store.getData()).toEqual({nested: {keep: 1, add: 3}, dict: {arbitrary: 2}});
        stop();

        storage.value = JSON.stringify({x: 2, extra: 3});
        let seen: unknown;
        const versioned = new Carburetor({x: 0});
        const stopVersioned = persist(versioned, config(storage, {
            version: 0, migrate: {}, prune: (saved, current) => {
                seen = [saved, {...current as object}];
                return saved;
            },
        }));
        expect(seen).toEqual([{x: 2, extra: 3}, {x: 0}]);
        stopVersioned();
    });

    test('pruning leaves native/class values and array members opaque', () => {
        const nativeValues: unknown[] = [new Map([['saved', 2]]), new Set([4]), new Date(1000)];
        const instance = new Model(3);
        const captured: unknown[] = [];
        class CapturingStore extends Carburetor<IData> {
            public override restore(data: IData): void {
                captured.push(data);
                super.restore(data);
            }
        }
        const saved = {
            native: [{saved: true}, {saved: true}, {saved: true}],
            instance: {saved: true}, rows: [{saved: true}], extra: true,
        };
        const storage = new Storage();
        storage.value = JSON.stringify(saved);
        const store = new CapturingStore({native: nativeValues[0], instance, rows: [{kept: 1}]});
        const stop = persist(store, config(storage, {prune: true}));
        const restored = captured[0] as IData;
        expect(restored.native).toEqual(saved.native);
        expect(restored.instance).toEqual(saved.instance);
        expect(restored.rows).toEqual(saved.rows);
        expect(restored).not.toHaveProperty('extra');
        expect(nativeValues).toHaveLength(3);
        expect(store.getData().native).toEqual(saved.native);
        expect(store.getData().instance).toEqual(saved.instance);
        expect(store.getData().rows[0]).toEqual({saved: true});
        stop();
    });

    test('migration preserves native references, class instances, and array members', () => {
        const map = new Map([['x', 1]]);
        const set = new Set([2]);
        const date = new Date(3000);
        const model = new Model(4);
        const rows = [{saved: true}];
        const store = new Carburetor<IData>({native: map, instance: model, rows});
        const storage = new Storage();
        storage.value = '{"__carburetorVersion":0,"data":{}}';
        const migrated = {native: [map, set, date], instance: model, rows};
        const stop = persist(store, config(storage, {
            version: 1, migrate: {1: () => migrated}, prune: true,
        }));
        const native = store.getData().native as unknown[];
        expect(native[0]).toBe(map);
        expect(native[1]).toBe(set);
        expect(native[2]).toBe(date);
        expect(store.getData().instance).toBe(model);
        expect(store.getData().rows[0]).toEqual({saved: true});
        stop();
    });

    test('merge preserves own __proto__ data on ordinary and null-prototype records', () => {
        const saved = Object.create(null) as Record<string, unknown>;
        const current = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(saved, '__proto__', {value: {saved: true}, enumerable: true});
        Object.defineProperty(current, '__proto__', {value: {defaulted: true}, enumerable: true});
        const result = mergeSaved(saved, current, true) as Record<string, unknown>;
        expect(Object.getPrototypeOf(result)).toBe(null);
        expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
        expect(result['__proto__']).toEqual({defaulted: true});

        const ordinarySaved = {} as Record<string, unknown>;
        Object.defineProperty(ordinarySaved, '__proto__', {value: 1, enumerable: true});
        const ordinary = mergeSaved(ordinarySaved, {__proto__: null}, false) as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(ordinary, '__proto__')).toBe(true);
        expect(ordinary['__proto__']).toBe(1);
    });

    test('legacy writes preserve raw format and call custom toJSON once', () => {
        let calls = 0;
        class Encoded extends Carburetor<{x: number}> {
            public toJSON(): unknown { calls++; return {wire: this.getData().x}; }
        }
        const storage = new Storage();
        const store = new Encoded({x: 0});
        const stop = persist(store, config(storage, {coalesce: false}));
        store.setData({x: 4});
        expect(storage.value).toBe('{"wire":4}');
        expect(calls).toBe(1);
        stop();
    });
});
