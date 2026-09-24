import {EResourceStatus, ResourceCarburetor} from "@/Carburetor";
import {deferred, flush, IDeferred} from "./helpers";

describe('ResourceCarburetor', () => {
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

    test('reload repeats the last request after an abort', async () => {
        const requested: string[] = [];
        const gates: IDeferred<string>[] = [deferred<string>(), deferred<string>()];
        let calls = 0;

        const resource = new ResourceCarburetor<string, {id: string}>((args) => {
            requested.push(args.id);

            return gates[calls++].promise;
        });

        const loading = resource.load({id: 'a'});
        resource.abort();

        gates[0].resolve('ignored');
        await loading;
        await flush();

        expect(resource.getData().status).toEqual(EResourceStatus.Idle);

        // abort() cancelled the request but not the memory of what was requested last.
        const reloaded = resource.reload();

        expect(requested).toEqual(['a', 'a']);

        gates[1].resolve('a-again');
        await reloaded;

        expect(resource.getData().status).toEqual(EResourceStatus.Success);
        expect(resource.getData().data).toEqual('a-again');
        expect(resource.suspend({id: 'a'})).toEqual('a-again');
    });

    test('reload before any load stays an intentional no-op', async () => {
        let calls = 0;

        const resource = new ResourceCarburetor<number>(() => {
            calls++;

            return Promise.resolve(calls);
        });

        await resource.reload();

        expect(calls).toEqual(0);
        expect(resource.getData().status).toEqual(EResourceStatus.Idle);
    });

    test('a restore into an instance that never loaded leaves reload a no-op', async () => {
        let sourceCalls = 0;

        const source = new ResourceCarburetor<string>(() => {
            sourceCalls++;

            return Promise.resolve('source-data');
        });

        await source.load(undefined);

        expect(sourceCalls).toEqual(1);

        let freshCalls = 0;

        const fresh = new ResourceCarburetor<string>(() => {
            freshCalls++;

            return Promise.resolve('fresh-data');
        });

        fresh.restore(JSON.parse(JSON.stringify(source.snapshot())));

        expect(fresh.getData().status).toEqual(EResourceStatus.Success);
        expect(fresh.suspend(undefined)).toEqual('source-data');

        // The snapshot names the answer's key, not the arguments that produced it: restore
        // serves the answer but cannot establish what reload would repeat.
        await fresh.reload();

        expect(freshCalls).toEqual(0);
        expect(fresh.getData().status).toEqual(EResourceStatus.Success);
        expect(fresh.getData().data).toEqual('source-data');
    });

    test('restore keeps an aborted load replayable by reload', async () => {
        const requested: string[] = [];
        const gates: IDeferred<string>[] = [deferred<string>(), deferred<string>()];
        let calls = 0;

        const resource = new ResourceCarburetor<string, {id: string}>((args) => {
            requested.push(args.id);

            return gates[calls++].promise;
        });

        const loading = resource.load({id: 'a'});
        resource.abort();

        gates[0].resolve('ignored');
        await loading;

        // A settled answer from elsewhere is restored over the aborted slot.
        resource.restore({
            status: EResourceStatus.Success,
            data: 'restored',
            error: undefined,
            updatedAt: 1,
            key: JSON.stringify({id: 'b'}),
        });

        expect(resource.getData().data).toEqual('restored');

        // reload repeats what THIS instance last requested ('a'), not the restored key.
        const reloaded = resource.reload();

        expect(requested).toEqual(['a', 'a']);

        gates[1].resolve('a-again');
        await reloaded;

        expect(resource.getData().data).toEqual('a-again');
    });
});
