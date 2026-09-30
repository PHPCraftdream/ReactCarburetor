import {EResourceStatus, IResourceData, IResourceSnapshot, ResourceCarburetor} from "@/Carburetor";
import {deferred, flush, IDeferred} from "./helpers";

const thrownBy = (resource: ResourceCarburetor<string, string>, key: string): unknown => {
    try {
        resource.suspend(key);
    } catch (error: unknown) {
        return error;
    }

    return undefined;
};

class WritableResource extends ResourceCarburetor<string, string> {
    /** Exposes the ordinary draft/update mutation for resource regression coverage. */
    public change(mutate: (draft: IResourceData<string>) => void): void {
        this.update(mutate);
    }
}

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

describe('single-slot public replacement', () => {
    test('distinct Success loses its old key before observers, and a read starts the actual loader', async () => {
        const next = deferred<string>();
        const requested: string[] = [];
        const resource = new ResourceCarburetor<string, string>((key) => {
            requested.push(key);
            return requested.length === 1 ? Promise.resolve('network:a') : next.promise;
        });
        await resource.load('a');
        const seen: IResourceSnapshot<string>[] = [];
        const stop = resource.subscribe(() => {
            seen.push(resource.snapshot());
            expect(JSON.parse(resource.serialize())).toEqual(resource.getData());
        });
        const replacement = {...resource.getData(), data: 'manual'};

        resource.setData(replacement);
        resource.unsubscribe(stop);

        expect(seen).toEqual([{...replacement, key: undefined}]);
        expect(resource.getData()).toBe(replacement);
        expect(resource.snapshot()).toEqual({...replacement, key: undefined});
        expect(JSON.parse(resource.serialize())).toEqual(replacement);
        const waiting = thrownBy(resource, 'a');
        expect(waiting).toBeInstanceOf(Promise);
        expect(requested).toEqual(['a', 'a']);
        next.resolve('network:a:again');
        await (waiting as Promise<void>);
        expect(resource.suspend('a')).toBe('network:a:again');
    });

    test('equal-valued distinct Success publishes key loss once; the current object does not', async () => {
        const next = deferred<string>();
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;
            return calls === 1 ? Promise.resolve('network:a') : next.promise;
        });
        await resource.load('a');
        const current = resource.getData();
        const seen: IResourceSnapshot<string>[] = [];
        const stop = resource.subscribe(() => {
            seen.push(resource.snapshot());
        });
        resource.setData(current);
        expect(resource.suspend('a')).toBe('network:a');
        expect(calls).toBe(1);
        expect(seen).toEqual([]);

        const equal = {...current};
        resource.setData(equal);
        resource.unsubscribe(stop);
        expect(seen).toEqual([{...equal, key: undefined}]);
        expect(resource.snapshot()).toEqual({...equal, key: undefined});
        expect(JSON.parse(resource.serialize())).toEqual(equal);
        const waiting = thrownBy(resource, 'a');
        expect(waiting).toBeInstanceOf(Promise);
        expect(calls).toBe(2);
        next.resolve('fresh');
        await (waiting as Promise<void>);
        expect(resource.suspend('a')).toBe('fresh');
    });

    test('a keyless Error replacement reconciles its raw cause before observers and refetches the old key', async () => {
        const original = new Error('transport-down');
        const next = deferred<string>();
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;
            return calls === 1 ? Promise.reject(original) : next.promise;
        });
        await resource.load('a');
        expect(thrownBy(resource, 'a')).toBe(original);

        const observed: Array<{raw: unknown; wire: IResourceSnapshot<string>; serialized: unknown}> = [];
        const stop = resource.subscribe(() => {
            observed.push({
                raw: resource.getLastError(),
                wire: resource.snapshot(),
                serialized: JSON.parse(resource.serialize()),
            });
        });
        const replacement = {...resource.getData(), status: EResourceStatus.Error, error: 'access-denied'};
        resource.setData(replacement);
        resource.unsubscribe(stop);

        const raw = resource.getLastError();
        expect(raw).toBeInstanceOf(Error);
        expect(raw).not.toBe(original);
        expect((raw as Error).message).toBe('access-denied');
        expect(resource.getData()).toBe(replacement);
        expect(resource.snapshot()).toEqual({...replacement, key: undefined});
        expect(JSON.parse(resource.serialize())).toEqual(replacement);
        expect(observed).toEqual([{raw, wire: resource.snapshot(), serialized: replacement}]);

        const waiting = thrownBy(resource, 'a');
        expect(waiting).toBeInstanceOf(Promise);
        expect(calls).toBe(2);
        next.resolve('network:a');
        await (waiting as Promise<void>);
        expect(resource.suspend('a')).toBe('network:a');
    });

    test('equal-valued distinct Error state publishes only the lost wire key once', async () => {
        const original = new Error('offline');
        const next = deferred<string>();
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;
            return calls === 1 ? Promise.reject(original) : next.promise;
        });
        await resource.load('a');
        const seen: Array<{wire: IResourceSnapshot<string>; serialized: unknown; raw: unknown}> = [];
        const id = resource.subscribe(() => {
            seen.push({
                wire: resource.snapshot(),
                serialized: JSON.parse(resource.serialize()),
                raw: resource.getLastError(),
            });
        });
        const replacement = {...resource.getData()};

        resource.setData(replacement);
        resource.unsubscribe(id);

        const raw = resource.getLastError();
        expect(raw).toBeInstanceOf(Error);
        expect(raw).not.toBe(original);
        expect((raw as Error).message).toBe('offline');
        expect(resource.getData()).toBe(replacement);
        expect(resource.snapshot()).toEqual({...replacement, key: undefined});
        expect(JSON.parse(resource.serialize())).toEqual(replacement);
        expect(seen).toEqual([{wire: resource.snapshot(), serialized: replacement, raw}]);

        const waiting = thrownBy(resource, 'a');
        expect(waiting).toBeInstanceOf(Promise);
        expect(calls).toBe(2);
        next.resolve('recovered');
        await (waiting as Promise<void>);
        expect(resource.suspend('a')).toBe('recovered');
    });

    test('installing the exact current Error state retains its original raw rejection', async () => {
        const original = new Error('offline');
        const resource = new ResourceCarburetor<string, string>(() => Promise.reject(original));
        await resource.load('a');
        const current = resource.getData();

        resource.setData(current);

        expect(resource.getData()).toBe(current);
        expect(resource.getLastError()).toBe(original);
        expect(thrownBy(resource, 'a')).toBe(original);
        expect(resource.snapshot()).toEqual({...current, key: JSON.stringify('a')});
        expect(JSON.parse(resource.serialize())).toEqual(resource.snapshot());
    });

    test('a keyless Success after a failure has no inherited key and fetches the old request again', async () => {
        const original = new Error('down');
        const next = deferred<string>();
        let calls = 0;
        const resource = new ResourceCarburetor<string, string>(() => {
            calls++;
            return calls === 1 ? Promise.reject(original) : next.promise;
        });
        await resource.load('a');
        const observed: Array<{raw: unknown; wire: IResourceSnapshot<string>; serialized: unknown}> = [];
        const stop = resource.subscribe(() => {
            observed.push({
                raw: resource.getLastError(),
                wire: resource.snapshot(),
                serialized: JSON.parse(resource.serialize()),
            });
        });

        const replacement = {...resource.getData(), status: EResourceStatus.Success,
            data: 'manual', error: undefined};
        resource.setData(replacement);
        resource.unsubscribe(stop);

        expect(resource.getLastError()).toBeUndefined();
        expect(resource.snapshot()).toEqual({...replacement, key: undefined});
        expect(JSON.parse(resource.serialize())).toEqual(replacement);
        expect(observed).toEqual([{raw: undefined, wire: resource.snapshot(), serialized: replacement}]);
        const waiting = thrownBy(resource, 'a');
        expect(waiting).toBeInstanceOf(Promise);
        expect(calls).toBe(2);
        next.resolve('network:a');
        await (waiting as Promise<void>);
        expect(resource.suspend('a')).toBe('network:a');
    });

    test('keyless public replacement leaves a current request alive without manufacturing an answer key', async () => {
        const gate = deferred<string>();
        let calls = 0;
        let signal: AbortSignal | undefined;
        const resource = new ResourceCarburetor<string, string>((_key, nextSignal) => {
            calls++;
            signal = nextSignal;
            return gate.promise;
        });
        const loading = resource.load('a');

        resource.setData({...resource.getData(), status: EResourceStatus.Error, error: 'manual'});

        expect(signal?.aborted).toBe(false);
        expect(resource.snapshot().key).toBeUndefined();
        expect(resource.getLastError()).toMatchObject({message: 'manual'});
        expect(resource.load('a')).toBe(loading);
        expect(calls).toBe(1);
        gate.resolve('server');
        await loading;
        expect(resource.getData().data).toBe('server');
        expect(resource.getLastError()).toBeUndefined();
        expect(resource.snapshot().key).toBe(JSON.stringify('a'));
        expect(resource.suspend('a')).toBe('server');
    });

    test('restore and fromJSON reconstruct rejection instead of retaining the previous raw cause', async () => {
        const original = new Error('down');
        const resource = new ResourceCarburetor<string, string>(() => Promise.reject(original));
        await resource.load('a');

        resource.restore({...resource.snapshot(), error: 'restored'});
        const restored = resource.getLastError();
        expect(restored).toBeInstanceOf(Error);
        expect(restored).not.toBe(original);
        expect((restored as Error).message).toBe('restored');
        expect(thrownBy(resource, 'a')).toBe(restored);
        expect(JSON.parse(resource.serialize())).toEqual(resource.snapshot());

        const wire = {...resource.snapshot(), error: 'hydrated', key: JSON.stringify('b')};
        resource.fromJSON(wire);
        const hydrated = resource.getLastError();
        expect(hydrated).toBeInstanceOf(Error);
        expect(hydrated).not.toBe(restored);
        expect((hydrated as Error).message).toBe('hydrated');
        expect(thrownBy(resource, 'b')).toBe(hydrated);
        expect(resource.getData().error).toBe('hydrated');
        expect(resource.snapshot()).toEqual(wire);
        expect(JSON.parse(resource.serialize())).toEqual(wire);
    });
});

describe('single-slot subclass mutation', () => {
    test('draft Error changes publish a matching raw cause and a later Success clears it', async () => {
        const original = new Error('older');
        const resource = new WritableResource(() => Promise.reject(original));
        await resource.load('a');
        const observations: Array<{
            state: IResourceData<string>;
            wire: IResourceSnapshot<string>;
            serialized: unknown;
            raw: unknown;
            result: unknown;
        }> = [];
        const id = resource.subscribe(() => {
            const state = resource.getData();
            observations.push({
                state: {...state},
                wire: resource.snapshot(),
                serialized: JSON.parse(resource.serialize()),
                raw: resource.getLastError(),
                result: state.status === EResourceStatus.Success
                    ? resource.suspend('a')
                    : thrownBy(resource, 'a'),
            });
        });

        resource.change(draft => { draft.error = 'changed-by-update'; });
        const updated = resource.getLastError();
        expect(updated).toBeInstanceOf(Error);
        expect(updated).not.toBe(original);
        expect((updated as Error).message).toBe('changed-by-update');
        expect(resource.getData().error).toBe('changed-by-update');
        expect(resource.snapshot().error).toBe('changed-by-update');
        expect(thrownBy(resource, 'a')).toBe(updated);

        resource.change(draft => { draft.updatedAt = 123; });
        expect(resource.getLastError()).toBe(updated);
        expect(thrownBy(resource, 'a')).toBe(updated);

        resource.change(draft => {
            draft.status = EResourceStatus.Success;
            draft.data = 'recovered';
            draft.error = undefined;
        });
        resource.unsubscribe(id);
        expect(resource.getLastError()).toBeUndefined();
        expect(resource.suspend('a')).toBe('recovered');
        expect(resource.snapshot().key).toBe(JSON.stringify('a'));
        expect(JSON.parse(resource.serialize())).toEqual(resource.snapshot());
        expect(observations).toHaveLength(3);
        for (const observation of observations) {
            expect(observation.wire).toEqual({...observation.state, key: JSON.stringify('a')});
            expect(observation.serialized).toEqual(observation.wire);
            if (observation.state.status === EResourceStatus.Error) {
                expect(observation.raw).toBe(updated);
                expect(observation.result).toBe(updated);
            } else {
                expect(observation.state.status).toBe(EResourceStatus.Success);
                expect(observation.raw).toBeUndefined();
                expect(observation.result).toBe('recovered');
            }
        }
    });

    test('an unchanged draft Error retains a non-Error raw rejection across publication', async () => {
        const original = {reason: 'offline'};
        const resource = new WritableResource(() => Promise.reject(original));
        await resource.load('a');
        const seen: unknown[] = [];
        const id = resource.subscribe(() => {
            seen.push([resource.getLastError(), thrownBy(resource, 'a'), resource.snapshot()]);
        });

        resource.change(draft => { draft.updatedAt = 123; });
        resource.unsubscribe(id);

        expect(resource.getLastError()).toBe(original);
        expect(thrownBy(resource, 'a')).toBe(original);
        expect(resource.snapshot().key).toBe(JSON.stringify('a'));
        expect(JSON.parse(resource.serialize())).toEqual(resource.snapshot());
        expect(seen).toEqual([[original, original, resource.snapshot()]]);
    });
});
