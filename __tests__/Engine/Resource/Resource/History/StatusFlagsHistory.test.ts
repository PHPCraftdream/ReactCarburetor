import {CarburetorHistory, EResourceStatus, ResourceCache, ResourceCarburetor} from '@/Carburetor';

/** Asserts exactly one status flag is true and it is the one the explicit table expects. */
const expectFlags = (
    data: {status: EResourceStatus; isIdle?: boolean; isPending?: boolean; isSuccess?: boolean; isError?: boolean},
    expected: 'isIdle' | 'isPending' | 'isSuccess' | 'isError',
): void => {
    const flags = {
        isIdle: data.isIdle === true, isPending: data.isPending === true,
        isSuccess: data.isSuccess === true, isError: data.isError === true,
    };
    const expectedMap: Record<EResourceStatus, 'isIdle' | 'isPending' | 'isSuccess' | 'isError'> = {
        [EResourceStatus.Idle]: 'isIdle', [EResourceStatus.Pending]: 'isPending',
        [EResourceStatus.Success]: 'isSuccess', [EResourceStatus.Error]: 'isError',
    };
    const trueFlags = Object.entries(flags).filter(([, value]) => value).map(([name]) => name);
    expect(trueFlags).toEqual([expected]);
    expect(expectedMap[data.status]).toBe(expected);
};

describe('status flags across undo/redo', () => {
    test('undo from success lands on Idle flags and redo restores success flags with data and key', async () => {
        const resource = new ResourceCarburetor<string, string>(async key => `answer-${key}`);
        const history = new CarburetorHistory(resource);
        await resource.load('a');

        expect(history.undo()).toBe(true);
        // A restored Pending entry has no live request: normalized to Idle.
        expectFlags(resource.getData(), 'isIdle');
        expect(resource.getData().status).toBe(EResourceStatus.Idle);

        expect(history.redo()).toBe(true);
        expectFlags(resource.getData(), 'isSuccess');
        expect(resource.snapshot()).toMatchObject({
            isSuccess: true, data: 'answer-a', key: JSON.stringify('a'),
        });
        history.disconnect();
    });

    test('undo/redo over an error status keeps error flags after redo', async () => {
        const resource = new ResourceCarburetor<string, string>(async key => {
            if (key === 'a') {
                throw new Error('offline');
            }

            return 'unused';
        });
        const history = new CarburetorHistory(resource);
        await resource.load('a').catch(() => undefined);
        expectFlags(resource.getData(), 'isError');

        expect(history.undo()).toBe(true);
        expectFlags(resource.getData(), 'isIdle');
        expect(history.redo()).toBe(true);
        expectFlags(resource.getData(), 'isError');
        expect(resource.snapshot()).toMatchObject({isError: true, error: 'offline', key: JSON.stringify('a')});
        history.disconnect();
    });

    test('cache undo/redo keeps entry flags consistent with status', async () => {
        const cache = new ResourceCache<unknown, string>(() => Promise.resolve('answer'), {ttl: Infinity});
        const history = new CarburetorHistory(cache);
        await cache.load('a');
        expectFlags(cache.getEntry('a'), 'isSuccess');

        expect(history.undo()).toBe(true);
        expectFlags(cache.getEntry('a'), 'isIdle');
        expect(history.redo()).toBe(true);
        expectFlags(cache.getEntry('a'), 'isSuccess');
        expect(cache.getEntry('a')).toMatchObject({isSuccess: true, data: 'answer'});
        history.disconnect();
    });
});
