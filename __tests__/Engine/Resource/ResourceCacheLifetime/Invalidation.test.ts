import {CarburetorHistory} from "@/Carburetor";
import {TPath, TPathSet} from "@/Carburetor/Models/Paths";
import {ResourceCache} from "@/Carburetor/Resource/Cache/ResourceCache";

const makeLoader = () => {
    const calls: string[] = [];
    const settle: ((value: string) => void)[] = [];

    const load = (id: string): Promise<string> => {
        calls.push(id);

        return new Promise<string>(resolve => settle.push(resolve));
    };

    return {calls, settle, load};
};

const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

/** Loads several keys and settles them all, leaving a populated cache. */
const fill = async (cache: ResourceCache<string, string>, loader: ReturnType<typeof makeLoader>, keys: string[]) => {
    for (const key of keys) {
        void cache.load(key);
    }

    loader.settle.forEach((resolve, index) => resolve(`value-${keys[index]}`));

    await flush();
};

const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('ResourceCache invalidation', () => {
    test('invalidate marks one entry stale without touching its data', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a', 'b']);

        cache.invalidate('a');

        expect(cache.getEntry('a').stale).toBeTruthy();
        expect(cache.getEntry('a').data).toEqual('value-a');
        // The data is as old as it was; only the verdict changed.
        expect(cache.getEntry('a').updatedAt).toBeDefined();
        expect(cache.getEntry('b').stale).toBeFalsy();
    });

    test('invalidate does not fetch by itself', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a']);
        cache.invalidate('a');

        expect(loader.calls).toEqual(['a']);

        // Asking for it is what fetches, and now it will, because the entry is stale.
        void cache.load('a');

        expect(loader.calls).toEqual(['a', 'a']);
    });

    test('a successful answer clears the invalidation', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a']);
        cache.invalidate('a');

        const request = cache.refresh('a');
        loader.settle[1]('fresh');
        await request;

        expect(cache.getEntry('a').stale).toBeFalsy();
        expect(cache.getEntry('a').data).toEqual('fresh');
    });

    test('invalidateAll marks every entry, which is the move after a write the server took', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});

        await fill(cache, loader, ['a', 'b', 'c']);

        cache.invalidateAll();

        ['a', 'b', 'c'].forEach((key: string) => {
            expect(cache.getEntry(key).stale).toBeTruthy();
            expect(cache.getEntry(key).data).toEqual(`value-${key}`);
        });
    });

    test('invalidating one entry wakes only its readers', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});
        let readerOfA = 0;
        let readerOfB = 0;

        await fill(cache, loader, ['a', 'b']);

        cache.subscribe(() => readerOfA++, {id: 'a', reads: readsOf(`entries.${cache.keyOf('a')}`)});
        cache.subscribe(() => readerOfB++, {id: 'b', reads: readsOf(`entries.${cache.keyOf('b')}`)});

        cache.invalidate('a');

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('CarburetorHistory undo discards a late in-flight answer from before the undo (R3-03)', async () => {
        const loader = makeLoader();
        const cache = new ResourceCache<string, string>(loader.load, {ttl: 60_000});
        const history = new CarburetorHistory(cache);

        void cache.load('a');
        loader.settle[0]('Ann');
        await flush();

        void cache.refresh('a');
        expect(cache.getEntry('a').refreshing).toBeTruthy();

        history.undo();

        expect(cache.getEntry('a').data).toEqual('Ann');
        expect(cache.getEntry('a').refreshing).toBeFalsy();

        // The refresh that was in flight when undo() ran belongs to a generation the undo
        // replaced.
        loader.settle[1]('late');
        await flush();

        expect(cache.getEntry('a').data).toEqual('Ann');
    });
});
