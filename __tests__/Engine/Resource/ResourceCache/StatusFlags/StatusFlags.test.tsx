import {EResourceStatus, ResourceCache} from '@/Carburetor';
import {IResourceCacheData, IResourceEntry} from '@/Carburetor/Models/Resource';
import {resourceStatusFlags} from '@/Carburetor/Resource/Status/resourceStatusFlags';
import {deferred} from '../../Resource/helpers';

/** Asserts the entry invariant: exactly one status flag is true and it matches `status`. */
const assertFlags = (entry: IResourceEntry<unknown>): void => {
    const flags = {
        isIdle: entry.isIdle, isPending: entry.isPending,
        isSuccess: entry.isSuccess, isError: entry.isError,
    };
    const trueFlags = Object.entries(flags).filter(([, value]) => value === true).map(([name]) => name);
    expect(trueFlags).toHaveLength(1);
    expect(flags).toEqual(resourceStatusFlags(entry.status));
};

const fixture = () => {
    const gates: Array<ReturnType<typeof deferred<unknown>>> = [];
    let calls = 0;
    const cache = new ResourceCache<unknown, string>(() => {
        const gate = deferred<unknown>();
        gates.push(gate);
        calls++;
        return gate.promise;
    }, {ttl: Infinity});
    const settle = async (index: number, value: unknown) => {
        gates[index].resolve(value);
        await gates[index].promise.catch(() => undefined);
    };
    const fail = async (index: number, error: unknown) => {
        gates[index].reject(error);
        await gates[index].promise.catch(() => undefined);
    };
    return {cache, settle, fail, calls: () => calls};
};

describe('ResourceCache status flags invariant', () => {
    test('load -> success writes exactly one true flag matching status', async () => {
        const state = fixture();
        const loading = state.cache.load('a');
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isPending: true, data: undefined});

        await state.settle(0, 'answer');
        await loading;
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isSuccess: true, data: 'answer'});
    });

    test('load -> error writes exactly one true flag matching status', async () => {
        const state = fixture();
        const loading = state.cache.load('a');
        await state.fail(0, new Error('offline'));
        await loading.catch(() => undefined);
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isError: true, data: undefined});
        expect(state.cache.getFailure('a')).toBeInstanceOf(Error);
    });

    test('refresh success keeps success flags while data and updatedAt move', async () => {
        const state = fixture();
        const first = state.cache.load('a');
        await state.settle(0, 'old');
        await first;
        const before = state.cache.getEntry('a').updatedAt;

        const refresh = state.cache.refresh('a');
        expect(state.cache.getEntry('a')).toMatchObject({isSuccess: true, refreshing: true});
        // updatedAt comes from Date.now(): wait past the millisecond of the first settle.
        await new Promise(resolve => setTimeout(resolve, 2));
        await state.settle(1, 'new');
        await refresh;
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isSuccess: true, data: 'new'});
        expect(state.cache.getEntry('a').updatedAt).not.toBe(before);
    });

    test('refresh failure keeps Success flags and only raises failed', async () => {
        const state = fixture();
        const first = state.cache.load('a');
        await state.settle(0, 'retained');
        await first;

        const refresh = state.cache.refresh('a');
        await state.fail(1, new Error('offline'));
        await refresh.catch(() => undefined);
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({
            status: EResourceStatus.Success, isSuccess: true, failed: true, data: 'retained',
        });
    });

    test('invalidate keeps the entry shape with a consistent flag set', async () => {
        const state = fixture();
        const first = state.cache.load('a');
        await state.settle(0, 'value');
        await first;

        state.cache.invalidate('a');
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isSuccess: true, invalidated: true});
    });

    test('forget removes the entry so the next resolve starts from Idle flags', async () => {
        const state = fixture();
        const first = state.cache.load('a');
        await state.settle(0, 'value');
        await first;

        state.cache.forget('a');
        const loading = state.cache.load('a');
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isPending: true, data: undefined});
        await state.settle(1, 'again');
        await loading;
        assertFlags(state.cache.getEntry('a'));
    });

    test('restore and fromJSON re-derive flags: legacy, contradicting and Pending payloads', () => {
        const state = fixture();
        const key = state.cache.resolve('a').key;

        // Legacy wire form without any flag fields.
        state.cache.restore({entries: {
            [key]: {status: EResourceStatus.Success, data: 'saved', error: undefined,
                updatedAt: 1, refreshing: false, invalidated: false, failed: false},
        } as unknown as IResourceCacheData<unknown>['entries']});
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isSuccess: true, data: 'saved'});

        // Contradicting flags: derived from status, incoming ignored.
        state.cache.restore({entries: {
            [key]: {status: EResourceStatus.Error, isIdle: true, isPending: false,
                isSuccess: true, isError: false, data: undefined, error: 'boom',
                updatedAt: 2, refreshing: false, invalidated: false, failed: false},
        } as unknown as IResourceCacheData<unknown>['entries']});
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({isError: true, isSuccess: false, error: 'boom'});

        // A restored Pending status has no live request: it normalizes to Idle.
        state.cache.restore({entries: {
            [key]: {status: EResourceStatus.Pending, isIdle: false, isPending: true,
                isSuccess: false, isError: false, data: undefined, error: undefined,
                updatedAt: 3, refreshing: false, invalidated: false, failed: false},
        } as unknown as IResourceCacheData<unknown>['entries']});
        assertFlags(state.cache.getEntry('a'));
        expect(state.cache.getEntry('a')).toMatchObject({
            isIdle: true, isPending: false, status: EResourceStatus.Idle,
        });

        // The wire form itself carries the derived flags.
        const wire = state.cache.toJSON() as IResourceCacheData<unknown>;
        assertFlags(wire.entries[key]);
        state.cache.fromJSON(JSON.parse(JSON.stringify(wire)));
        assertFlags(state.cache.getEntry('a'));
    });
});
