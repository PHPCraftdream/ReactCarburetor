import {Carburetor, IStorageLike, diagnostics, persist} from '@/Carburetor';

class MemoryStorage implements IStorageLike {
    public entries = new Map<string, string>();
    public removed: string[] = [];
    public failing = false;

    public getItem(key: string): string | null { return this.entries.get(key) ?? null; }
    public setItem(key: string, value: string): void {
        if (this.failing) throw new Error('quota');
        this.entries.set(key, value);
    }
    public removeItem(key: string): void {
        this.removed.push(key);
        this.entries.delete(key);
    }
}

const tick = (): Promise<void> => Promise.resolve();

afterEach(() => diagnostics.setFailureHandler(undefined));

describe('persist: the write after a restore fails', () => {
    test('with onError the error goes there', () => {
        const storage = new MemoryStorage();
        storage.entries.set('k', '{"a":1}');
        storage.failing = true;
        const errors: unknown[] = [];
        const stop = persist(new Carburetor({a: 0, b: 2}), {
            key: 'k', storage, writeAfterRestore: 'always', onError: (error) => errors.push(error),
        });

        expect(errors).toHaveLength(1);
        stop();
    });

    test('without onError it reaches the failure handler as persist', () => {
        const storage = new MemoryStorage();
        storage.entries.set('k', '{"a":1}');
        storage.failing = true;
        const sources: string[] = [];
        diagnostics.setFailureHandler((_error, source) => sources.push(source));
        const stop = persist(new Carburetor({a: 0, b: 2}), {key: 'k', storage, writeAfterRestore: 'always'});

        expect(sources).toEqual(['persist']);
        stop();
    });
});

describe('persist partitions: branches that cannot be written', () => {
    test('a branch that does not serialize goes to onError, or to the failure handler', () => {
        const storage = new MemoryStorage();
        const errors: unknown[] = [];
        const store = new Carburetor<{a: {n: unknown}}>({a: {n: 0}});
        const stop = persist(store, {key: 'app', storage, partitions: ['a'], onError: (error) => errors.push(error)});

        store.setData({a: {n: BigInt(1)}});
        stop.flush();
        expect(errors).toHaveLength(1);
        stop();

        const sources: string[] = [];
        diagnostics.setFailureHandler((_error, source) => sources.push(source));
        const other = new Carburetor<{a: {n: unknown}}>({a: {n: 0}});
        const stopOther = persist(other, {key: 'other', storage, partitions: ['a']});

        other.setData({a: {n: BigInt(2)}});
        stopOther.flush();
        expect(sources).toEqual(['persist']);
        stopOther();
    });

    test('a branch that becomes undefined removes its entry', () => {
        const storage = new MemoryStorage();
        const store = new Carburetor<{a?: {n: number}; b: {n: number}}>({a: {n: 1}, b: {n: 1}});
        const stop = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        // The first write seals every branch, so 'a' is stored before it disappears.
        store.setData({a: {n: 2}, b: {n: 1}});
        stop.flush();
        expect(storage.entries.has('app.a')).toBe(true);
        store.setData({b: {n: 2}});
        stop.flush();
        expect(storage.removed).toEqual(['app.a']);
        expect(storage.entries.has('app.a')).toBe(false);
        stop();
    });

    test('a dispatch queued before store disposal writes nothing afterwards', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 0}});
        persist(store, {key: 'app', storage, partitions: ['a']});

        store.setData({a: {n: 1}});
        store.dispose();
        const written = new Map(storage.entries);
        await tick();
        expect(storage.entries).toEqual(written);
        expect(JSON.parse(storage.entries.get('app.a') as string)).toEqual({n: 1});
    });
});
