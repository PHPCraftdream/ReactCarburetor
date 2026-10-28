import {Carburetor, ComponentUpdateThrottle, IStorageLike, persist} from '@/Carburetor';
import {flush} from '@/Testing';

class Storage implements IStorageLike {
    entries = new Map<string, string>();
    getItem = (key: string): string | null => this.entries.get(key) ?? null;
    setItem = (key: string, value: string): void => { this.entries.set(key, value); };
    removeItem = (key: string): void => { this.entries.delete(key); };
}
const settle = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve));

describe('persistence recovery branches', () => {
    test('reports failed storage reads and proceeds; reports a failed write', async () => {
        const storage = new Storage();
        const errors: unknown[] = [];
        storage.getItem = () => { throw Error('read'); };
        const store = new Carburetor({count: 0});
        const stop = persist(store, {key: 'slot', storage, onError: e => errors.push(e)});
        storage.setItem = () => { throw Error('write'); };
        store.setData({count: 1});
        await settle();
        expect(errors.map(error => (error as Error).message)).toEqual(['read', 'write']);
        stop();
    });

    test('migrates previous-key data and reports transfer failure without throwing', () => {
        const storage = new Storage();
        storage.entries.set('old', JSON.stringify({count: 4}));
        const errors: unknown[] = [];
        storage.setItem = () => { throw Error('transfer'); };
        const store = new Carburetor({count: 0});
        const stop = persist(store, {key: 'slot', storage, previousKeys: ['old'], onError: e => errors.push(e)});
        expect(store.getData()).toEqual({count: 4});
        expect((errors[0] as Error).message).toBe('transfer');
        stop();
    });

    test('writes restored changed data and forces pending persistence on dispose', async () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 5, extra: true}));
        const store = new Carburetor({count: 0});
        const stop = persist(store, {key: 'slot', storage, prune: true});
        expect(store.getData()).toEqual({count: 5});
        expect(JSON.parse(storage.entries.get('slot') as string)).toEqual({count: 5});
        stop();

        const other = new Storage();
        const changed = new Carburetor({count: 0}, new ComponentUpdateThrottle(40));
        const dispose = persist(changed, {key: 'counter', storage: other});
        changed.setData({count: 2});
        expect(other.entries.has('counter')).toBe(false);
        dispose();
        expect(JSON.parse(other.entries.get('counter') as string)).toEqual({count: 2});
    });

    test('keeps malformed versioned data and throws when no error handler is supplied', () => {
        const storage = new Storage();
        const corrupt = '{bad';
        storage.entries.set('slot', corrupt);
        expect(() => persist(new Carburetor({count: 0}), {key: 'slot', storage, version: 0})).toThrow();
        expect(storage.entries.get('slot')).toBe(corrupt);
    });

    test('reports reset cleanup failure and continues writing', async () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({__carburetorVersion: 0, data: {count: 2}}));
        const removal = Error('remove');
        storage.removeItem = () => { throw removal; };
        const errors: unknown[] = [];
        class RejectingStore extends Carburetor<{count: number}> {
            restore(): void { throw Error('restore'); }
        }
        const store = new RejectingStore({count: 0});
        const stop = persist(store, {key: 'slot', storage, version: 0, onCorrupt: 'reset',
            onError: e => errors.push(e)});
        expect(errors.map(error => (error as Error).message)).toEqual(['restore', 'remove']);
        store.restore = Carburetor.prototype.restore;
        store.setData({count: 3});
        await settle();
        expect(JSON.parse(storage.entries.get('slot') as string)).toEqual({
            __carburetorVersion: 0,
            data: {count: 3},
        });
        stop();
    });

    test('reports a rejected fallback restore and leaves its source untouched', () => {
        const storage = new Storage();
        storage.entries.set('old', JSON.stringify({count: 4}));
        const errors: unknown[] = [];
        const store = new Carburetor({count: 0});
        store.restore = () => { throw Error('restore'); };
        const stop = persist(store, {key: 'slot', storage, previousKeys: ['old'], onError: e => errors.push(e)});
        expect((errors[0] as Error).message).toBe('restore');
        expect(storage.entries.has('old')).toBe(true);
        stop();
    });

    test('reports failed cleanup after rejected unversioned restore', () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 4}));
        const errors: unknown[] = [];
        storage.removeItem = () => { throw Error('remove'); };
        const store = new Carburetor({count: 0});
        store.restore = () => { throw Error('restore'); };
        const stop = persist(store, {key: 'slot', storage, onError: e => errors.push(e)});
        expect(errors.map(e => (e as Error).message)).toEqual(['restore', 'remove']);
        stop();
    });

    test('reports a failed write-after-restore through onError', () => {
        const storage = new Storage();
        storage.entries.set('slot', JSON.stringify({count: 4}));
        const failure = Error('rewrite');
        const errors: unknown[] = [];
        storage.setItem = () => { throw failure; };
        const stop = persist(new Carburetor({count: 0}), {
            key: 'slot', storage, writeAfterRestore: 'always', onError: e => errors.push(e),
        });
        expect(errors).toContain(failure);
        stop();
    });

    test('flush clears a throttled timer and persists the latest value', async () => {
        const storage = new Storage();
        const store = new Carburetor({count: 0});
        const stop = persist(store, {key: 'slot', storage, throttleMs: 10000});
        store.setData({count: 1});
        await settle();
        store.setData({count: 2});
        await settle();
        flush(store);
        expect(JSON.parse(storage.entries.get('slot') as string)).toEqual({count: 2});
        stop();
    });
});
