import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {
    Carburetor, CarburetorChildScope, CarburetorContext, CarburetorProvider, CarburetorScope, EResourceStatus,
    IStorageLike, ResourceCache, ResourceCarburetor, carburetorToken, persist, waitForUpdate,
} from '@/Carburetor';
import {createTestClock, createTestScope} from '@/Testing';

class MemoryStorage implements IStorageLike {
    public entries = new Map<string, string>();
    public writes = 0;

    public getItem(key: string): string | null { return this.entries.get(key) ?? null; }
    public setItem(key: string, value: string): void {
        this.writes++;
        this.entries.set(key, value);
    }
    public removeItem(key: string): void { this.entries.delete(key); }
}

interface ICount {n: number}

const tick = (): Promise<void> => Promise.resolve();

describe('persist across a child scope unmount and remount', () => {
    test('a remounted instance reads the state the unmounted one held back', async () => {
        const storage = new MemoryStorage();
        const token = carburetorToken(() => {
            const store = new Carburetor<ICount>({n: 0});
            persist(store, {key: 'count', storage, throttleMs: 60_000});
            return store;
        }, 'persist-lifecycle/count');
        const seen: Array<Carburetor<ICount>> = [];
        const Capture = (): null => {
            const scope = React.useContext(CarburetorContext);
            if (scope === null) throw new Error('parent missing');
            const store = scope.get(token) as Carburetor<ICount>;
            if (!seen.includes(store)) seen.push(store);
            return null;
        };
        const parent = new CarburetorScope();
        const tree = (
            <CarburetorProvider scope={parent}>
                <CarburetorChildScope tokens={[token]}><Capture/></CarburetorChildScope>
            </CarburetorProvider>
        );

        const first = render(tree);
        await act(async () => {
            seen[0].setData({n: 1});
            await tick();
            seen[0].setData({n: 2});
            await tick();
        });
        first.unmount();

        expect(JSON.parse(storage.getItem('count') as string)).toEqual({n: 2});

        const second = render(tree);
        expect(seen).toHaveLength(2);
        expect(seen[1].getData()).toEqual({n: 2});
        second.unmount();
        parent.dispose();
    });
});

describe('persist in a test scope with a clock', () => {
    test('scope.dispose() writes a held-back state at once and leaves no timer', async () => {
        const clock = createTestClock();
        const storage = new MemoryStorage();
        const token = carburetorToken(() => new Carburetor<ICount>({n: 0}), 'persist-lifecycle/clocked');
        const store = new Carburetor<ICount>({n: 0});
        const scope = createTestScope([[token, store]], {clock});
        const handed = scope.get(token) as Carburetor<ICount>;
        persist(handed, {key: 'clocked', storage, throttleMs: 1000});

        handed.setData({n: 1});
        await tick();
        handed.setData({n: 2});
        await tick();
        expect(clock.pending).toBe(1);

        scope.dispose();
        expect(JSON.parse(storage.getItem('clocked') as string)).toEqual({n: 2});
        expect(clock.pending).toBe(0);
    });
});

describe('a resource disposed with a request in flight', () => {
    test('persist writes the state at disposal and the late answer writes nothing', async () => {
        const storage = new MemoryStorage();
        let answer: (value: string) => void = () => undefined;
        const resource = new ResourceCarburetor<string, [string]>(
            () => new Promise<string>((resolve) => { answer = resolve; })
        );
        persist(resource, {key: 'resource', storage});

        const loading = resource.load('a').catch(() => undefined);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);
        resource.dispose();
        const writes = storage.writes;
        expect(storage.getItem('resource')).not.toBeNull();

        answer('late');
        await loading;
        await tick();
        expect(storage.writes).toBe(writes);
    });
});

describe('waitForUpdate on resource stores', () => {
    test('a disposed ResourceCache rejects the wait at once', async () => {
        const cache = new ResourceCache(async (id: string) => id);
        const waiting = waitForUpdate(cache, 60_000);

        cache.dispose();

        await expect(waiting).rejects.toThrow(/the store was disposed/);
    });

    test('a disposed ResourceCarburetor rejects the wait at once', async () => {
        const resource = new ResourceCarburetor<string, [string]>(async (id: string) => id);
        const waiting = waitForUpdate(resource, 60_000);

        resource.dispose();

        await expect(waiting).rejects.toThrow(/the store was disposed/);
    });
});
