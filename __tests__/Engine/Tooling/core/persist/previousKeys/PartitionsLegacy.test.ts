import {Carburetor, IStorageLike, persist} from '@/Carburetor';
import {flush} from '@/Testing';

class MemoryStorage implements IStorageLike {
    public entries = new Map<string, string>();

    public getItem(key: string): string | null {
        return this.entries.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        this.entries.set(key, value);
    }

    public removeItem(key: string): void {
        this.entries.delete(key);
    }
}

class Pair extends Carburetor<{a: {n: number}; b: {n: number}}> {
    public setA(n: number): void { this.update(draft => { draft.a.n = n; }); }
}

const legacy = (): string => JSON.stringify({a: {n: 7}, b: {n: 8}});

/**
 * The documented contract of `partitions`: the legacy whole-store entry is a read fallback that stays
 * in storage, shadowed once partition entries exist. These tests pin both halves, so a change to it
 * (for example removing the legacy entry after a migration) is a deliberate decision, not an accident.
 */
describe('persist partitions and the legacy whole-store entry', () => {
    test('the legacy entry survives a migration and is restored again when the partition entries are gone', () => {
        const storage = new MemoryStorage();
        storage.entries.set('app', legacy());

        const migrated = new Pair({a: {n: 0}, b: {n: 0}});
        const stop = persist(migrated, {key: 'app', storage, partitions: ['a', 'b']});

        expect(migrated.getData()).toEqual({a: {n: 7}, b: {n: 8}});

        migrated.setA(9);
        flush(migrated);

        expect(JSON.parse(storage.entries.get('app.a') as string)).toEqual({n: 9});
        expect(JSON.parse(storage.entries.get('app.b') as string)).toEqual({n: 8});
        expect(storage.entries.get('app')).toBe(legacy());
        stop();

        storage.entries.delete('app.a');
        storage.entries.delete('app.b');

        const next = new Pair({a: {n: 0}, b: {n: 0}});
        const stopNext = persist(next, {key: 'app', storage, partitions: ['a', 'b']});

        expect(next.getData()).toEqual({a: {n: 7}, b: {n: 8}});
        stopNext();
    });

    test('while any partition entry exists the legacy entry is not read for the others', () => {
        const storage = new MemoryStorage();
        storage.entries.set('app', legacy());
        storage.entries.set('app.a', JSON.stringify({n: 1}));

        const store = new Pair({a: {n: 0}, b: {n: 5}});
        const stop = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

        expect(store.getData()).toEqual({a: {n: 1}, b: {n: 5}});
        stop();
    });

    test('malformed partition entries are dropped, reported, and the intact legacy entry restores instead', () => {
        const storage = new MemoryStorage();
        const errors: unknown[] = [];
        storage.entries.set('app', legacy());
        storage.entries.set('app.a', '{not json');

        const store = new Pair({a: {n: 0}, b: {n: 0}});
        const stop = persist(store, {
            key: 'app', storage, partitions: ['a', 'b'], onError: error => errors.push(error),
        });

        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(SyntaxError);
        expect(storage.entries.has('app.a')).toBe(false);
        expect(store.getData()).toEqual({a: {n: 7}, b: {n: 8}});
        stop();
    });
});
