import {EResourceStatus} from "@/Carburetor/Models/Enums/EResourceStatus";
import {IResourceSnapshot} from "@/Carburetor/Models/Resource";
import {ResourceCarburetor} from "@/Carburetor/Resource/ResourceCarburetor";
import {deferred} from "./helpers";

describe('ResourceCarburetor reentrant loads', () => {
    test('a synchronous subscriber joins the request before the loader runs', async () => {
        const gate = deferred<string>();
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;

            return gate.promise;
        });
        let joined: Promise<void> | undefined;
        let reentered = false;

        resource.subscribe(() => {
            if (!reentered) {
                reentered = true;
                joined = resource.load('a');
            }
        }, {id: 'reentrant'});

        const request = resource.load('a');

        expect(joined).toBe(request);
        expect(calls).toEqual(1);
        expect(resource.getData().status).toEqual(EResourceStatus.Pending);

        gate.resolve('loaded');
        await request;

        expect(resource.getData().data).toEqual('loaded');
        expect(resource.getData().status).toEqual(EResourceStatus.Success);
    });

    test('a distinct key started by a subscriber replaces and aborts the first request', async () => {
        const gates = {a: deferred<string>(), b: deferred<string>()};
        const started: Array<{key: string; signal: AbortSignal}> = [];
        const resource = new ResourceCarburetor<string, 'a' | 'b'>((key, signal) => {
            started.push({key, signal});

            return gates[key].promise;
        });
        let second: Promise<void> | undefined;
        let switched = false;

        resource.subscribe(() => {
            if (!switched) {
                switched = true;
                second = resource.load('b');
            }
        }, {id: 'replace'});

        const first = resource.load('a');

        expect(started).toHaveLength(1);
        expect(started[0].key).toBe('b');
        expect(started[0].signal.aborted).toBe(false);

        gates.b.resolve('current');
        await expect(first).rejects.toMatchObject({name: 'AbortError'});
        await second;

        expect(resource.getData().data).toEqual('current');
        expect(resource.getData().status).toEqual(EResourceStatus.Success);
    });

    test('abort during notification rejects work that never reached its loader', async () => {
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;

            return Promise.resolve('late');
        });

        resource.subscribe(() => resource.abort(), {id: 'abort'});

        const request = resource.load('a');

        expect(calls).toEqual(0);
        expect(resource.getData().status).toEqual(EResourceStatus.Idle);

        await expect(request).rejects.toMatchObject({name: 'AbortError'});

        expect(resource.getData().status).toEqual(EResourceStatus.Idle);
        expect(resource.getData().data).toBeUndefined();
    });

    test('an abort listener can retry the same key without joining the cancelled request', async () => {
        const gates = [deferred<string>(), deferred<string>()];
        const signals: AbortSignal[] = [];
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>((_key, signal) => {
            signals.push(signal);

            return gates[calls++].promise;
        });
        const cancelled = resource.load('a');
        let retry: Promise<void> | undefined;
        signals[0].addEventListener('abort', () => {
            retry = resource.load('a');
        });

        resource.abort();

        expect(signals[0].aborted).toBe(true);
        expect(retry).toBeDefined();
        expect(retry).not.toBe(cancelled);
        expect(calls).toBe(2);
        expect(signals[1].aborted).toBe(false);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);

        gates[1].resolve('retried');
        await retry;
        gates[0].resolve('stale');
        await cancelled;

        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('retried');
    });

    test('a different-key abort-listener replacement rejects the superseded outer start', async () => {
        const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
        const signals: AbortSignal[] = [];
        const keys: string[] = [];
        const resource = new ResourceCarburetor<string, string>((key, signal) => {
            keys.push(key);
            signals.push(signal);

            return gates[key === 'a' ? 0 : key === 'c' ? 1 : 2].promise;
        });
        const first = resource.load('a');
        let reentrant: Promise<void> | undefined;
        signals[0].addEventListener('abort', () => {
            reentrant = resource.load('c');
        });

        const outer = resource.load('b');

        expect(signals[0].aborted).toBe(true);
        expect(reentrant).toBeDefined();
        expect(outer).not.toBe(reentrant);
        expect(keys).toEqual(['a', 'c']);
        expect(signals[1].aborted).toBe(false);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);

        await expect(outer).rejects.toMatchObject({name: 'AbortError'});
        gates[1].resolve('current');
        await reentrant;
        gates[0].resolve('stale');
        await first;

        expect(resource.getData().data).toBe('current');
        expect(resource.getData().status).toBe(EResourceStatus.Success);
    });

    test('an abort listener request survives restore without receiving the snapshot', async () => {
        const gates = [deferred<string>(), deferred<string>()];
        const signals: AbortSignal[] = [];
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>((_key, signal) => {
            signals.push(signal);

            return gates[calls++].promise;
        });
        const first = resource.load('a');
        const snapshot: IResourceSnapshot<string> = {
            status: EResourceStatus.Success,
            data: 'restored',
            error: undefined,
            updatedAt: 1,
            key: JSON.stringify('restored'),
        };
        let reentrant: Promise<void> | undefined;
        signals[0].addEventListener('abort', () => {
            reentrant = resource.load('c');
        });

        resource.restore(snapshot);

        expect(signals[0].aborted).toBe(true);
        expect(reentrant).toBeDefined();
        expect(calls).toBe(2);
        expect(signals[1].aborted).toBe(false);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);
        expect(resource.getData().data).toBeUndefined();

        gates[1].resolve('current');
        await reentrant;
        gates[0].resolve('stale');
        await first;

        expect(resource.getData().data).toBe('current');
        expect(resource.getData().status).toBe(EResourceStatus.Success);
    });
});
