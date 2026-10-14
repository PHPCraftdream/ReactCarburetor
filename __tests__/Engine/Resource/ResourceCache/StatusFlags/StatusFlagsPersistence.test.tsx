import {EResourceStatus, IStorageLike, persist, ResourceCache} from '@/Carburetor';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {deferred} from '../../Resource/helpers';

/** Asserts exactly one status flag is true and it is the one the explicit table expects. */
const expectFlags = (
    entry: {status: EResourceStatus; isIdle?: boolean; isPending?: boolean; isSuccess?: boolean; isError?: boolean},
    expected: 'isIdle' | 'isPending' | 'isSuccess' | 'isError',
): void => {
    const flags = {
        isIdle: entry.isIdle === true, isPending: entry.isPending === true,
        isSuccess: entry.isSuccess === true, isError: entry.isError === true,
    };
    const expectedMap: Record<EResourceStatus, 'isIdle' | 'isPending' | 'isSuccess' | 'isError'> = {
        [EResourceStatus.Idle]: 'isIdle', [EResourceStatus.Pending]: 'isPending',
        [EResourceStatus.Success]: 'isSuccess', [EResourceStatus.Error]: 'isError',
    };
    const trueFlags = Object.entries(flags).filter(([, value]) => value).map(([name]) => name);
    expect(trueFlags).toEqual([expected]);
    expect(expectedMap[entry.status]).toBe(expected);
};

const fixture = () => {
    const gates: Array<ReturnType<typeof deferred<unknown>>> = [];
    const cache = new ResourceCache<unknown, string>(() => {
        const gate = deferred<unknown>();
        gates.push(gate);
        return gate.promise;
    }, {ttl: Infinity});
    const settle = async (index: number, value: unknown) => {
        gates[index].resolve(value);
        await gates[index].promise.catch(() => undefined);
    };
    return {cache, settle};
};

const memoryStorage = (): {storage: IStorageLike; entries: Map<string, string>} => {
    const entries = new Map<string, string>();
    return {
        entries,
        storage: {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
            removeItem: key => { entries.delete(key); },
        },
    };
};

describe('ResourceCache status flags across persistence', () => {
    test('persist writes the cache wire form with a success entry after load -> success', async () => {
        const state = fixture();
        const {storage, entries} = memoryStorage();
        const stop = persist(state.cache, {key: 'slot', storage, coalesce: false});

        const loading = state.cache.load('a');
        await state.settle(0, 'answer');
        await loading;
        await Promise.resolve(); // drain the non-coalesced write

        const parsed = JSON.parse(entries.get('slot') as string) as IResourceCacheData<unknown>;
        const key = state.cache.resolve('a').key;
        const entry = parsed.entries[key] as IResourceEntry<unknown>;
        expect(entry.status).toBe(EResourceStatus.Success);
        expectFlags(entry, 'isSuccess');
        stop();
    });

    test('a legacy stored entry without flag fields hydrates flags from status', () => {
        const state = fixture();
        const key = state.cache.resolve('a').key;
        const {entries} = memoryStorage();
        entries.set('slot', JSON.stringify({
            entries: {
                [key]: {status: EResourceStatus.Success, data: 'saved', error: undefined,
                    updatedAt: 1, refreshing: false, invalidated: false, failed: false},
            },
        }));

        const fresh = new ResourceCache<unknown, string>(async () => 'unused', {ttl: Infinity});
        fresh.fromJSON(JSON.parse(entries.get('slot') as string));
        expectFlags(fresh.getEntry('a'), 'isSuccess');
        expect(fresh.getEntry('a')).toMatchObject({isSuccess: true, data: 'saved'});
    });

    test('contradicting stored flags are ignored in favor of status', () => {
        const state = fixture();
        const key = state.cache.resolve('a').key;
        const {entries} = memoryStorage();
        entries.set('slot', JSON.stringify({
            entries: {
                [key]: {status: EResourceStatus.Error, isIdle: false, isPending: false,
                    isSuccess: true, isError: false, data: undefined, error: 'boom',
                    updatedAt: 2, refreshing: false, invalidated: false, failed: false},
            },
        }));

        const fresh = new ResourceCache<unknown, string>(async () => 'unused', {ttl: Infinity});
        fresh.fromJSON(JSON.parse(entries.get('slot') as string));
        expectFlags(fresh.getEntry('a'), 'isError');
        expect(fresh.getEntry('a')).toMatchObject({isError: true, isSuccess: false, error: 'boom'});
    });
});
