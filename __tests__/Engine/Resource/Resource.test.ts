import {EResourceStatus, ResourceCarburetor} from "@/Carburetor";

interface IDeferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

const deferred = <T extends unknown>(): IDeferred<T> => {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return {promise, resolve, reject};
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ResourceCarburetor', () => {
    test('walks idle -> pending -> success', async () => {
        const gate = deferred<string>();
        const resource = new ResourceCarburetor<string>(() => gate.promise);

        expect(resource.getData().status).toEqual(EResourceStatus.Idle);

        const loading = resource.load(undefined);
        expect(resource.getData().status).toEqual(EResourceStatus.Pending);

        gate.resolve('loaded');
        await loading;

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('loaded');
        expect(resource.getData().error).toEqual(undefined);
        expect(typeof resource.getData().updatedAt).toEqual('number');
    });

    test('records a failure as a serializable message and keeps the raw error', async () => {
        const failure = new Error('nope');
        const resource = new ResourceCarburetor<string>(() => Promise.reject(failure));

        await resource.load(undefined);

        expect(resource.getData().status).toEqual(EResourceStatus.Error);
        expect(resource.getData().error).toEqual('nope');
        expect(resource.getLastError()).toBe(failure);
        expect(JSON.stringify(resource.getData())).toContain('nope');
    });

    test('a loader that throws synchronously settles like a rejection', async () => {
        const failure = new Error('thrown');
        let calls = 0;

        const resource = new ResourceCarburetor<string>(() => {
            calls++;

            if (calls === 1) {
                throw failure;
            }

            return Promise.resolve('recovered');
        });

        // The failure is handled by the load promise, not thrown out of it — the same shape an
        // async rejection takes.
        await resource.load(undefined);

        expect(resource.getData().status).toEqual(EResourceStatus.Error);
        expect(resource.getData().error).toEqual('thrown');
        expect(resource.getLastError()).toBe(failure);

        // The slot is not wedged: a retry runs the loader again and settles normally.
        await resource.load(undefined);

        expect(calls).toEqual(2);
        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('recovered');
    });

    test('shares one request between concurrent loads with the same arguments', async () => {
        let calls = 0;
        const gate = deferred<number>();

        const resource = new ResourceCarburetor<number, {id: string}>((args: {id: string}) => {
            calls++;
            expect(args.id).toEqual('a');

            return gate.promise;
        });

        const first = resource.load({id: 'a'});
        const second = resource.load({id: 'a'});

        expect(calls).toEqual(1);
        expect(first).toBe(second);

        gate.resolve(1);
        await first;

        expect(resource.getData().data).toEqual(1);
    });

    test('a load with different arguments aborts the previous one', async () => {
        const firstGate = deferred<string>();
        const secondGate = deferred<string>();
        const signals: AbortSignal[] = [];

        const resource = new ResourceCarburetor<string, {id: string}>((args, signal) => {
            signals.push(signal);

            return args.id === 'a' ? firstGate.promise : secondGate.promise;
        });

        const stale = resource.load({id: 'a'});
        const fresh = resource.load({id: 'b'});

        expect(signals[0].aborted).toBeTruthy();
        expect(signals[1].aborted).toBeFalsy();

        // The abandoned request must not overwrite the state of the current one.
        firstGate.resolve('stale');
        secondGate.resolve('fresh');
        await Promise.all([stale, fresh]);
        await flush();

        expect(resource.getData().data).toEqual('fresh');
    });

    test('abort returns the slot to idle without settling the request', async () => {
        const gate = deferred<string>();
        const resource = new ResourceCarburetor<string>(() => gate.promise);

        const loading = resource.load(undefined);
        resource.abort();

        gate.resolve('ignored');
        await loading;
        await flush();

        // Pending would promise an answer nothing delivers; the slot claims nothing is happening.
        expect(resource.getData().status).toEqual(EResourceStatus.Idle);
        expect(resource.getData().data).toEqual(undefined);
    });

    test('reload repeats the last request', async () => {
        let calls = 0;

        const resource = new ResourceCarburetor<number, {id: string}>(() => {
            calls++;

            return Promise.resolve(calls);
        });

        await resource.load({id: 'a'});
        expect(resource.getData().data).toEqual(1);

        await resource.reload();
        expect(calls).toEqual(2);
        expect(resource.getData().data).toEqual(2);
    });

    test('notifies subscribers of status changes with path precision', async () => {
        const gate = deferred<string>();
        const resource = new ResourceCarburetor<string>(() => gate.promise);

        let statusReader = 0;
        let dataReader = 0;

        resource.watch(new Set(['status']), () => statusReader++);
        resource.watch(new Set(['data']), () => dataReader++);

        const loading = resource.load(undefined);
        expect(statusReader).toEqual(1);
        expect(dataReader).toEqual(0);

        gate.resolve('loaded');
        await loading;

        expect(statusReader).toEqual(2);
        expect(dataReader).toEqual(1);
    });

    test('a suspend for a different key does not serve the stored answer', async () => {
        const gates: Record<string, IDeferred<string>> = {a: deferred<string>(), b: deferred<string>()};
        const requested: string[] = [];

        const resource = new ResourceCarburetor<string, {id: string}>((args) => {
            requested.push(args.id);

            return gates[args.id].promise;
        });

        gates.a.resolve('a-data');
        await resource.load({id: 'a'});

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('a-data');

        // 'b' must not be answered by the slot still holding a's data: it suspends on a
        // fresh request, and only b's own answer ever comes back for it.
        let caught: unknown;

        try {
            resource.suspend({id: 'b'});
        } catch (error: unknown) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(Promise);
        expect(requested).toEqual(['a', 'b']);

        gates.b.resolve('b-data');
        await (caught as Promise<void>);
        await flush();

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('b-data');
        expect(resource.suspend({id: 'b'})).toEqual('b-data');
    });

    test('a suspend for a different key does not rethrow the stored failure', async () => {
        const gates: Record<string, IDeferred<string>> = {a: deferred<string>(), b: deferred<string>()};

        const resource = new ResourceCarburetor<string, {id: string}>((args) => gates[args.id].promise);

        gates.a.reject(new Error('a failed'));
        await resource.load({id: 'a'}).catch(() => undefined);

        expect(resource.getData().status).toEqual(EResourceStatus.Error);
        // The failure still belongs to 'a', and is still rethrown for it.
        expect(() => resource.suspend({id: 'a'})).toThrow('a failed');

        let caught: unknown;

        try {
            resource.suspend({id: 'b'});
        } catch (error: unknown) {
            caught = error;
        }

        // 'b' gets its own request instead of a's error.
        expect(caught).toBeInstanceOf(Promise);

        gates.b.resolve('b-data');
        await (caught as Promise<void>);
        await flush();

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('b-data');
    });

    test('a suspend for the stored key keeps returning the cached answer', async () => {
        let calls = 0;

        const resource = new ResourceCarburetor<number, {id: string}>(() => {
            calls++;

            return Promise.resolve(calls);
        });

        await resource.load({id: 'a'});

        expect(resource.suspend({id: 'a'})).toEqual(1);
        expect(resource.suspend({id: 'a'})).toEqual(1);
        expect(calls).toEqual(1);
    });

    test('after an aborted replacement load, suspending the old key fetches again', async () => {
        const requested: string[] = [];
        const resolvers: Array<(value: string) => void> = [];

        const resource = new ResourceCarburetor<string, {id: string}>((args) => {
            requested.push(args.id);

            return new Promise<string>((resolve) => {
                resolvers.push(resolve);
            });
        });

        const loading = resource.load({id: 'a'});
        resolvers[0]('a-first');
        await loading;

        expect(resource.getData().data).toEqual('a-first');

        // 'b' starts and is aborted before it settles, so its answer is ignored.
        const replaced = resource.load({id: 'b'});
        resource.abort();

        resolvers[1]('b-late');
        await replaced;
        await flush();

        expect(resource.getData().status).toEqual(EResourceStatus.Idle);

        // The slot holds no answer, so 'a' suspends on a fresh request rather than
        // trusting what was stored before the abort.
        let caught: unknown;

        try {
            resource.suspend({id: 'a'});
        } catch (error: unknown) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(Promise);
        expect(requested).toEqual(['a', 'b', 'a']);

        resolvers[2]('a-second');
        await (caught as Promise<void>);
        await flush();

        expect(resource.getData().data).toEqual('a-second');
        expect(resource.suspend({id: 'a'})).toEqual('a-second');
    });

    test('an abort with nothing in flight leaves the settled answer in place', async () => {
        let calls = 0;

        const resource = new ResourceCarburetor<number, {id: string}>(() => {
            calls++;

            return Promise.resolve(calls);
        });

        await resource.load({id: 'a'});
        resource.abort();

        expect(resource.suspend({id: 'a'})).toEqual(1);
        expect(calls).toEqual(1);
    });

    test('restoring a snapshot does not serve the restored answer to another key', async () => {
        // A fresh gate per request: the same key is loaded more than once here, and a gate
        // already resolved would answer the later request with the first one's value.
        const gates: Record<string, IDeferred<string>[]> = {a: [], b: []};
        const requested: string[] = [];

        const resource = new ResourceCarburetor<string, {id: string}>((args) => {
            requested.push(args.id);

            const gate = deferred<string>();
            gates[args.id].push(gate);

            return gate.promise;
        });

        const loadingA = resource.load({id: 'a'});
        gates.a[0].resolve('a-data');
        await loadingA;

        const snapshot = resource.snapshot();

        const loadingB = resource.load({id: 'b'});
        gates.b[0].resolve('b-data');
        await loadingB;

        resource.restore(snapshot);

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('a-data');

        // The restored answer is a's, and 'b' was loaded only after the snapshot was taken:
        // reading b starts a fresh request rather than being handed a's data.
        let caught: unknown;

        try {
            resource.suspend({id: 'b'});
        } catch (error: unknown) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(Promise);
        expect(requested).toEqual(['a', 'b', 'b']);

        gates.b[1].resolve('b-data-2');
        await (caught as Promise<void>);
        await flush();

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('b-data-2');
        expect(resource.suspend({id: 'b'})).toEqual('b-data-2');
    });

    test('a hydrated answer is served for its own key without a new request', async () => {
        let sourceCalls = 0;

        const source = new ResourceCarburetor<string, {id: string}>(() => {
            sourceCalls++;

            return Promise.resolve('a-data');
        });

        await source.load({id: 'a'});
        expect(sourceCalls).toEqual(1);

        let freshCalls = 0;

        const fresh = new ResourceCarburetor<string, {id: string}>(() => {
            freshCalls++;

            return Promise.resolve('fresh-data');
        });

        fresh.fromJSON(JSON.parse(JSON.stringify(source.snapshot())));

        let caught: unknown;

        try {
            fresh.suspend({id: 'a'});
        } catch (error: unknown) {
            caught = error;
        }

        // The answer came across the serialization boundary, so the restored instance must
        // serve it for the key it settled under instead of asking the loader again.
        expect(caught).toEqual(undefined);
        expect(fresh.suspend({id: 'a'})).toEqual('a-data');
        expect(freshCalls).toEqual(0);
        expect(fresh.getData().status).toEqual(EResourceStatus.Success);
    });

    test('restoring an error snapshot keeps the failure bound to its key', async () => {
        const gates: Record<string, IDeferred<string>> = {a: deferred<string>(), b: deferred<string>()};

        const source = new ResourceCarburetor<string, {id: string}>(() => gates.a.promise);

        gates.a.reject(new Error('a failed'));
        await source.load({id: 'a'}).catch(() => undefined);

        let freshCalls = 0;

        const fresh = new ResourceCarburetor<string, {id: string}>(() => {
            freshCalls++;

            return gates.b.promise;
        });

        fresh.fromJSON(JSON.parse(JSON.stringify(source.snapshot())));

        // The message crossed the boundary as text, so the failure is rebuilt from it and
        // stays rethrown for the key that produced it.
        expect(fresh.getData().status).toEqual(EResourceStatus.Error);
        expect(fresh.getData().error).toEqual('a failed');
        expect(fresh.getLastError()).toBeInstanceOf(Error);
        expect(() => fresh.suspend({id: 'a'})).toThrow('a failed');

        // 'b' gets its own request instead of a's restored failure.
        let caught: unknown;

        try {
            fresh.suspend({id: 'b'});
        } catch (error: unknown) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(Promise);
        expect(freshCalls).toEqual(1);

        gates.b.resolve('b-data');
        await (caught as Promise<void>);
        await flush();

        expect(fresh.getData().status).toEqual(EResourceStatus.Success);
        expect(fresh.getData().data).toEqual('b-data');
    });

    test('restoring over a request in flight drops the stale answer', async () => {
        const gates: Record<string, IDeferred<string>[]> = {a: [], b: []};
        const requested: string[] = [];
        const signals: AbortSignal[] = [];

        const resource = new ResourceCarburetor<string, {id: string}>((args, signal) => {
            requested.push(args.id);
            signals.push(signal);

            const gate = deferred<string>();
            gates[args.id].push(gate);

            return gate.promise;
        });

        const loadingA = resource.load({id: 'a'});
        gates.a[0].resolve('a-data');
        await loadingA;

        const snapshot = resource.snapshot();

        // The request left in flight is serving a state the restore replaces wholesale.
        const stale = resource.load({id: 'b'});

        resource.restore(snapshot);

        expect(signals[1].aborted).toBeTruthy();

        gates.b[0].resolve('b-late');
        await stale;
        await flush();

        // The abandoned answer lands nowhere: the restored state stays what it was.
        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('a-data');
        expect(resource.suspend({id: 'a'})).toEqual('a-data');
        expect(requested).toEqual(['a', 'b']);

        // 'b' never settled, so reading it starts a fresh request rather than being handed
        // the restored a answer.
        let caught: unknown;

        try {
            resource.suspend({id: 'b'});
        } catch (error: unknown) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(Promise);
        expect(requested).toEqual(['a', 'b', 'b']);

        gates.b[1].resolve('b-data-2');
        await (caught as Promise<void>);
        await flush();

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('b-data-2');
    });

    test('restoring a Pending snapshot into a fresh instance leaves no false pending claim (R3-04)', async () => {
        const gate = deferred<string>();
        const source = new ResourceCarburetor<string>(() => gate.promise);

        const stalled = source.load(undefined);
        expect(source.getData().status).toEqual(EResourceStatus.Pending);

        // A Pending snapshot: nothing about it names the arguments a fresh request would need.
        const snapshot = source.snapshot();

        let freshCalls = 0;
        const fresh = new ResourceCarburetor<string>(() => {
            freshCalls++;

            return Promise.resolve('fresh-data');
        });

        fresh.restore(snapshot);

        // No request exists behind the fresh instance: a plain status reader must not be told
        // one is on its way forever.
        expect(fresh.getData().status).toEqual(EResourceStatus.Idle);
        expect(fresh.getData().data).toEqual(undefined);

        // The slot is genuinely idle, not merely reporting so: an explicit load still fetches.
        await fresh.load(undefined);

        expect(freshCalls).toEqual(1);
        expect(fresh.getData().status).toEqual(EResourceStatus.Success);
        expect(fresh.getData().data).toEqual('fresh-data');

        gate.resolve('late');
        await stalled;
    });

    test('restoring a Pending snapshot that already carries data preserves it under Idle', async () => {
        const gates: IDeferred<string>[] = [deferred<string>(), deferred<string>()];
        let calls = 0;

        const source = new ResourceCarburetor<string>(() => gates[calls++].promise);

        const first = source.load(undefined);
        gates[0].resolve('first');
        await first;

        expect(source.getData().data).toEqual('first');

        // A second start leaves the previous answer's data in place while going Pending —
        // this resource's own existing "refresh" shape (start() clears error, not data).
        const reload = source.reload();

        expect(source.getData().status).toEqual(EResourceStatus.Pending);
        expect(source.getData().data).toEqual('first');

        const snapshot = source.snapshot();

        const fresh = new ResourceCarburetor<string>(() => gates[1].promise);

        fresh.restore(snapshot);

        // Normalized to Idle, with the last-good data preserved for a plain reader.
        expect(fresh.getData().status).toEqual(EResourceStatus.Idle);
        expect(fresh.getData().data).toEqual('first');

        gates[1].resolve('second');
        await reload;
    });
});
