import {EResourceStatus, IResourceData, ResourceCarburetor} from '@/Carburetor';
import {IResourceSnapshot} from '@/Carburetor/Models/Resource';
import {resourceStatusFlags} from '@/Carburetor/Resource/Status/resourceStatusFlags';
import {deferred, flush} from '../helpers';

/** Asserts the slot invariant: exactly one status flag is true and it matches `status`. */
const assertFlags = (data: IResourceData<unknown>): void => {
    const flags = {
        isIdle: data.isIdle, isPending: data.isPending,
        isSuccess: data.isSuccess, isError: data.isError,
    };
    const trueFlags = Object.entries(flags).filter(([, value]) => value === true).map(([name]) => name);
    expect(trueFlags).toHaveLength(1);
    const expected = resourceStatusFlags(data.status);
    expect(flags).toEqual(expected);
};

describe('ResourceCarburetor status flags invariant', () => {
    test('idle -> load -> success keeps exactly one true flag matching status', async () => {
        const gate = deferred<string>();
        const resource = new ResourceCarburetor<string>(() => gate.promise);
        assertFlags(resource.getData());
        expect(resource.getData().isIdle).toBe(true);

        const loading = resource.load(undefined);
        assertFlags(resource.getData());
        expect(resource.getData().isPending).toBe(true);

        gate.resolve('loaded');
        await loading;
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isSuccess: true, data: 'loaded'});
    });

    test('load -> error keeps exactly one true flag matching status', async () => {
        const resource = new ResourceCarburetor<string>(() => Promise.reject(new Error('nope')));
        await resource.load(undefined);
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isError: true, error: 'nope'});
    });

    test('abort from pending normalizes to idle and drops the late answer', async () => {
        const gate = deferred<string>();
        let signal!: AbortSignal;
        const resource = new ResourceCarburetor<string>((_args, requestSignal) => {
            signal = requestSignal;
            return gate.promise;
        });
        const loading = resource.load('a');
        expect(resource.getData().isPending).toBe(true);

        resource.abort();
        expect(signal.aborted).toBe(true);
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isIdle: true, data: undefined});

        gate.resolve('late');
        await loading.catch(() => undefined);
        await flush();
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isIdle: true, data: undefined});
    });

    test('reload from success passes back through pending with consistent flags', async () => {
        let calls = 0;
        const gates = [deferred<string>(), deferred<string>()];
        const resource = new ResourceCarburetor<string>(() => gates[calls++].promise);
        const first = resource.load('a');
        gates[0].resolve('one');
        await first;
        expect(resource.getData().isSuccess).toBe(true);

        const second = resource.reload();
        assertFlags(resource.getData());
        expect(resource.getData().isPending).toBe(true);
        gates[1].resolve('two');
        await second;
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isSuccess: true, data: 'two'});
    });

    test('a second load supersedes the pending one without breaking the invariant', async () => {
        let calls = 0;
        const gates = [deferred<string>(), deferred<string>()];
        const resource = new ResourceCarburetor<string>(() => gates[calls++].promise);
        // Distinct arguments: a same-key load joins the in-flight request, only a new
        // key supersedes the pending one and rejects its promise.
        const first = resource.load('a');
        const second = resource.load('b');
        expect(resource.getData().isPending).toBe(true);
        gates[0].resolve('retired');
        await first.catch(() => undefined);
        assertFlags(resource.getData());
        gates[1].resolve('current');
        await second;
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isSuccess: true, data: 'current'});
    });

    test('restore() re-derives flags from status and normalizes Pending to Idle', () => {
        const resource = new ResourceCarburetor<string>(() => new Promise<string>(() => undefined));

        resource.restore({
            ...resourceStatusFlags(EResourceStatus.Success), status: EResourceStatus.Success,
            data: 'saved', error: undefined, updatedAt: 1, key: JSON.stringify('a'),
        });
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isSuccess: true, data: 'saved'});

        // A payload with contradicting flags: the incoming flags are ignored and re-derived.
        resource.restore({
            status: EResourceStatus.Success, isIdle: false, isPending: true,
            isSuccess: false, isError: true,
            data: 'contradiction', error: undefined, updatedAt: 2,
        } as unknown as IResourceSnapshot<string>);
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isSuccess: true, isError: false, data: 'contradiction'});

        // A restored Pending status has no live request: it normalizes to Idle.
        resource.restore({
            status: EResourceStatus.Pending, data: undefined, error: undefined, updatedAt: 3,
        } as unknown as IResourceSnapshot<string>);
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isIdle: true, isPending: false, status: EResourceStatus.Idle});
    });

    test('fromJSON accepts legacy payloads without flags and hydrates consistent ones', () => {
        const resource = new ResourceCarburetor<string>(() => new Promise<string>(() => undefined));

        // Legacy wire form: no flag fields at all.
        resource.fromJSON({status: EResourceStatus.Error, data: undefined, error: 'legacy', updatedAt: 5});
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isError: true, error: 'legacy'});

        // Wire form with contradicting flags: still re-derived from status.
        resource.fromJSON({
            status: EResourceStatus.Idle, isIdle: false, isPending: true,
            isSuccess: true, isError: false, data: 'stale', error: undefined, updatedAt: 6,
        });
        assertFlags(resource.getData());
        expect(resource.getData()).toMatchObject({isIdle: true, status: EResourceStatus.Idle});
    });
});
