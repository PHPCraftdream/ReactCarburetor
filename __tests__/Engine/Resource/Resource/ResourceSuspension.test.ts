import {EResourceStatus, ResourceCarburetor} from "@/Carburetor";
import {deferred, flush, IDeferred} from "./helpers";

describe('ResourceCarburetor', () => {
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
});
