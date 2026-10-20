import {EResourceStatus, ResourceCache, ResourceCarburetor} from "@/Carburetor";
import {deferred, flush} from "../../Resource/Keys/helpers";

describe('resource disposal', () => {
    test.each(['load', 'refresh', 'suspend'] as const)(
        'ResourceCarburetor %s rejects after disposal before loading', method => {
            let calls = 0;
            const resource = new ResourceCarburetor<string>(() => {
                calls++;
                return Promise.resolve('x');
            });
            resource.dispose();
            const invoke = (): unknown => method === 'suspend'
                ? resource.suspend(undefined) : resource[method](undefined);
            expect(invoke).toThrow('Carburetor: store has been disposed');
            expect(calls).toBe(0);
        },
    );

    test.each(['load', 'refresh', 'suspend'] as const)(
        'ResourceCache %s rejects after disposal before loading', method => {
            let calls = 0;
            const cache = new ResourceCache<string, [string]>(() => {
                calls++;
                return Promise.resolve('x');
            });
            cache.dispose();
            const invoke = (): unknown => method === 'suspend' ? cache.suspend('x') : cache[method]('x');
            expect(invoke).toThrow('Carburetor: store has been disposed');
            expect(calls).toBe(0);
        },
    );

    test.each(['load', 'refresh', 'suspend'] as const)(
        'abort listeners cannot restart ResourceCarburetor with %s', async method => {
            let calls = 0;
            let listenerCalls = 0;
            let signal!: AbortSignal;
            let failure: unknown;
            const gate = deferred<string>();
            const resource = new ResourceCarburetor<string>((_arg, currentSignal) => {
                calls++;
                signal = currentSignal;
                signal.addEventListener('abort', () => {
                    listenerCalls++;
                    try {
                        if (method === 'suspend') resource.suspend(undefined);
                        else void resource[method](undefined);
                    } catch (error) { failure = error; }
                });
                return gate.promise;
            });
            const request = resource.load(undefined);
            resource.dispose();
            gate.resolve('done');
            await request;
            expect(listenerCalls).toBe(1);
            expect(failure).toEqual(new Error('Carburetor: store has been disposed'));
            expect(signal.aborted).toBe(true);
            expect(calls).toBe(1);
        },
    );

    test.each(['load', 'refresh', 'suspend'] as const)(
        'abort listeners cannot restart ResourceCache with %s', async method => {
            let calls = 0;
            let listenerCalls = 0;
            let signal!: AbortSignal;
            let failure: unknown;
            const gate = deferred<string>();
            const cache = new ResourceCache<string, [string]>((_key, currentSignal) => {
                calls++;
                signal = currentSignal;
                signal.addEventListener('abort', () => {
                    listenerCalls++;
                    try {
                        if (method === 'suspend') cache.suspend('x');
                        else void cache[method]('x');
                    } catch (error) { failure = error; }
                });
                return gate.promise;
            });
            const request = cache.load('x');
            cache.dispose();
            gate.resolve('done');
            await request;
            expect(listenerCalls).toBe(1);
            expect(failure).toEqual(new Error('Carburetor: store has been disposed'));
            expect(signal.aborted).toBe(true);
            expect(calls).toBe(1);
        },
    );

    test.each(['resource', 'cache'] as const)(
        'disposing during key derivation prevents %s request creation', type => {
            let calls = 0;
            let instance: {dispose(): void};
            const key = (): string => {
                instance.dispose();
                return 'key';
            };
            instance = type === 'resource'
                ? new ResourceCarburetor<string>(() => { calls++; return Promise.resolve('x'); }, {key})
                : new ResourceCache<string, [string]>(() => {
                    calls++;
                    return Promise.resolve('x');
                }, {key});
            expect(() => type === 'resource'
                ? (instance as ResourceCarburetor<string>).load(undefined)
                : (instance as ResourceCache<string, [string]>).load('x'))
                .toThrow('Carburetor: store has been disposed');
            expect(calls).toBe(0);
        },
    );

    test.each(['resource', 'cache'] as const)(
        'mid-refresh disposal rejects refresh with the disposed error for %s', async type => {
            let calls = 0;
            let instance!: {dispose(): void};
            const gate = deferred<string>();
            const loader = (_arg: string | undefined, signal: AbortSignal): Promise<string> => {
                calls++;
                signal.addEventListener('abort', () => instance.dispose());
                return gate.promise;
            };
            instance = type === 'resource'
                ? new ResourceCarburetor<string>(loader as never, {key: () => 'key'})
                : new ResourceCache<string, [string]>(loader as never, {key: () => 'key'});
            const initial = type === 'resource'
                ? (instance as ResourceCarburetor<string>).load(undefined)
                : (instance as ResourceCache<string, [string]>).load('x');
            let rejection: unknown;
            const runRefresh = (): void => {
                const requested = type === 'resource'
                    ? (instance as ResourceCarburetor<string>).refresh(undefined)
                    : (instance as ResourceCache<string, [string]>).refresh('x');
                requested.catch((error: unknown) => { rejection = error; });
            };
            if (type === 'resource') {
                // The abort listener disposes inside refresh(): the slot path throws synchronously.
                expect(runRefresh).toThrow(new Error('Carburetor: store has been disposed'));
            } else {
                // The cache path must reject with the same entry-guard error, not an undefined reason.
                runRefresh();
                await flush();
                expect(rejection).toEqual(new Error('Carburetor: store has been disposed'));
            }
            gate.resolve('done');
            await initial;
            expect(calls).toBe(1);
        },
    );

    test('ResourceCarburetor dispose aborts its pending request without publishing', async () => {
        const gate = deferred<string>();
        let signal!: AbortSignal;
        const resource = new ResourceCarburetor<string>((_arg, currentSignal) => {
            signal = currentSignal;
            return gate.promise;
        });
        let notifications = 0;
        resource.subscribe(() => { notifications++; });
        const request = resource.load(undefined);
        const beforeDispose = notifications;
        resource.dispose();
        gate.resolve('too late');
        await request;
        await flush();
        expect(signal.aborted).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);
        expect(notifications).toBe(beforeDispose);
    });

    test('ResourceCache dispose aborts all pending requests without publishing', async () => {
        const pending: Array<{signal: AbortSignal; resolve: (value: string) => void}> = [];
        const cache = new ResourceCache<string, [string]>((_key, signal) => new Promise(resolve => {
            pending.push({signal, resolve});
        }));
        let notifications = 0;
        cache.subscribe(() => { notifications++; });
        const requests = [cache.load('a'), cache.load('b')];
        const beforeDispose = notifications;
        cache.dispose();
        pending.forEach(({resolve}) => resolve('too late'));
        await Promise.all(requests);
        await flush();
        expect(pending.every(({signal}) => signal.aborted)).toBe(true);
        expect(notifications).toBe(beforeDispose);
    });
});
