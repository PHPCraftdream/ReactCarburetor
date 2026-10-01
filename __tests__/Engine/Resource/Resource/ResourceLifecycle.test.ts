import {CarburetorHistory, EResourceStatus, ResourceCarburetor} from "@/Carburetor";
import {deferred, flush} from "./helpers";

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

        resource.watch((data) => data.status, () => statusReader++);
        resource.watch((data) => data.data, () => dataReader++);

        const loading = resource.load(undefined);
        expect(statusReader).toEqual(1);
        expect(dataReader).toEqual(0);

        gate.resolve('loaded');
        await loading;

        expect(statusReader).toEqual(2);
        expect(dataReader).toEqual(1);
    });
    test('loads through an owned readonly Pending replay without mutating captured endpoints', async () => {
        const gate = deferred<number>();
        let calls = 0;
        const resource = new ResourceCarburetor<number | {map: Map<object, object>}, string>(() => {
            calls++;
            return gate.promise;
        });
        const history = new CarburetorHistory(resource);
        const map = new Map<object, object>();
        const payload = {map};
        const pending = {status: EResourceStatus.Pending, data: payload, error: 'old', updatedAt: 7};
        map.set(pending, payload);
        map.set(payload, pending);
        for (const field of ['status', 'data', 'error', 'updatedAt'] as const) {
            Object.defineProperty(pending, field, {
                value: pending[field], writable: false, configurable: false, enumerable: true,
            });
        }
        resource.setData(pending);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        const held = resource.getData();
        const loading = resource.load('new');
        expect(calls).toBe(1);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);
        expect(resource.load('new')).toBe(loading);
        const current = resource.getData();
        const currentPayload = current.data as typeof payload;
        expect(currentPayload.map.get(current)).toBe(currentPayload);
        expect(currentPayload.map.get(currentPayload)).toBe(current);
        gate.resolve(42);
        await loading;
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe(42);
        expect(resource.getData().error).toBeUndefined();
        expect(resource.getData().updatedAt).toBeGreaterThan(7);
        expect(resource.snapshot().key).toBe(JSON.stringify('new'));
        expect(held.status).toBe(EResourceStatus.Idle);
        expect(held.error).toBe('old');
        expect(held.updatedAt).toBe(7);
        expect(Object.getOwnPropertyDescriptor(held, 'updatedAt')?.writable).toBe(false);
        expect(pending.status).toBe(EResourceStatus.Pending);
        expect(map.get(pending)).toBe(payload);
        history.disconnect();
    });

    test('suspend, abort, error and reload settle after readonly replay', async () => {
        const first = deferred<number>();
        const second = deferred<number>();
        const raw = {reason: 'offline'};
        let calls = 0;
        const resource = new ResourceCarburetor<number, string>(() => {
            calls++;
            return calls === 1 ? first.promise : calls === 2 ? Promise.reject(raw) : second.promise;
        });
        const history = new CarburetorHistory(resource);
        const pending = {status: EResourceStatus.Pending, data: 3, error: undefined, updatedAt: 7};
        Object.defineProperty(pending, 'status', {
            value: EResourceStatus.Pending, writable: false, configurable: false, enumerable: true,
        });
        Object.defineProperty(pending, 'updatedAt', {
            value: 7, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(pending);
        history.undo();
        history.redo();
        let suspended!: Promise<void>;
        try {
            resource.suspend('one');
        } catch (thrown) {
            suspended = thrown as Promise<void>;
        }
        expect(calls).toBe(1);
        resource.abort();
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        first.resolve(10);
        await suspended;
        expect(resource.getData().data).toBe(3);
        await resource.load('two');
        expect(resource.getData().status).toBe(EResourceStatus.Error);
        expect(resource.getData().error).toBe('[object Object]');
        expect(resource.getLastError()).toBe(raw);
        expect(resource.snapshot().key).toBe(JSON.stringify('two'));
        const reload = resource.reload();
        second.resolve(99);
        await reload;
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe(99);
        expect(resource.snapshot().key).toBe(JSON.stringify('two'));
        expect(calls).toBe(3);
        history.disconnect();
    });

    test('a pending subscriber joins readonly replay before its loader runs', async () => {
        const gate = deferred<number>();
        let calls = 0;
        let joined: Promise<void> | undefined;
        const resource = new ResourceCarburetor<number, string>(() => {
            calls++;
            return gate.promise;
        });
        const history = new CarburetorHistory(resource);
        const pending = {status: EResourceStatus.Pending, data: 1, error: undefined, updatedAt: 2};
        Object.defineProperty(pending, 'status', {
            value: EResourceStatus.Pending, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(pending);
        history.undo();
        history.redo();
        resource.watch(state => state.status, status => {
            if (status === EResourceStatus.Pending) joined = resource.load('same');
        });
        const request = resource.load('same');
        expect(joined).toBe(request);
        expect(calls).toBe(1);
        gate.resolve(8);
        await request;
        expect(resource.getData().data).toBe(8);
        expect(resource.snapshot().key).toBe(JSON.stringify('same'));
        history.disconnect();
    });

    test('readonly slot operations keep native accessor metadata, aliases and held endpoints', async () => {
        const key = {id: 1};
        const map = new Map<unknown, unknown>();
        const set = new Set<unknown>();
        const date = new Date(123);
        const payload = {key, alias: key, map, set, date};
        const source = {
            status: EResourceStatus.Success, data: payload, error: undefined, updatedAt: 7,
        };
        map.set(key, source);
        map.set(source, payload);
        set.add(source);
        set.add(key);
        Object.defineProperty(date, 'owner', {
            value: source, enumerable: false, writable: false, configurable: false,
        });
        let getterCalls = 0;
        let setterCalls = 0;
        const getter = (): string => { getterCalls++; throw new Error('native getter invoked'); };
        const setter = (_value: string): void => { setterCalls++; };
        for (const native of [map, set, date]) {
            Object.defineProperty(native, 'metadata', {
                get: getter, set: setter, enumerable: true, configurable: false,
            });
        }
        for (const field of ['status', 'data', 'error', 'updatedAt'] as const) {
            Object.defineProperty(source, field, {
                value: source[field], enumerable: true, writable: false, configurable: false,
            });
        }
        const first = deferred<string>();
        const failure = new Error('unavailable');
        let calls = 0;
        const resource = new ResourceCarburetor<typeof payload | string, string>(() => {
            calls++;
            return calls === 1 ? first.promise
                : calls === 2 ? Promise.reject(failure) : Promise.resolve('recovered');
        });
        resource.setData(source);
        expect(() => new CarburetorHistory(resource)).toThrow(Error);
        expect(getterCalls).toBe(0);

        let suspended!: Promise<void>;
        try {
            resource.suspend('first');
        } catch (thrown) {
            suspended = thrown as Promise<void>;
        }
        expect(calls).toBe(1);
        const pending = resource.getData();
        const owned = pending.data as typeof payload;
        expect(pending).not.toBe(source);
        expect(pending.status).toBe(EResourceStatus.Pending);
        expect(owned).not.toBe(payload);
        expect(owned.alias).toBe(owned.key);
        expect(owned.map.get(owned.key)).toBe(pending);
        expect(owned.map.get(pending)).toBe(owned);
        expect(owned.set.has(pending)).toBe(true);
        expect(owned.set.has(owned.key)).toBe(true);
        expect(owned.date.getTime()).toBe(123);
        expect(Object.getOwnPropertyDescriptor(owned.date, 'owner')).toMatchObject({
            value: pending, enumerable: false, writable: false, configurable: false,
        });
        for (const native of [owned.map, owned.set, owned.date]) {
            expect(Object.getOwnPropertyDescriptor(native, 'metadata')).toMatchObject({
                get: getter, set: setter, enumerable: true, configurable: false,
            });
        }
        expect(Object.getOwnPropertyDescriptor(source, 'status')?.writable).toBe(false);
        expect(source.status).toBe(EResourceStatus.Success);
        expect(map.get(source)).toBe(payload);
        expect(set.has(source)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(date, 'owner')?.value).toBe(source);
        resource.abort();
        first.resolve('stale');
        await suspended;
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(resource.getData().data).toBe(owned);

        resource.setData(source);
        await resource.load('second');
        expect(calls).toBe(2);
        expect(resource.getData().status).toBe(EResourceStatus.Error);
        expect(resource.getData().error).toBe('unavailable');
        expect(resource.getLastError()).toBe(failure);
        resource.setData(source);
        await resource.reload();
        expect(calls).toBe(3);
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('recovered');
        expect(resource.snapshot().key).toBe(JSON.stringify('second'));
        expect(getterCalls).toBe(0);
        expect(setterCalls).toBe(0);
    });

    test('a failed Pending publication rejects only its request and restores the old answer', async () => {
        class ThrowingResource extends ResourceCarburetor<number, string> {
            public failPublication = false;

            protected preEmit(): void {
                if (this.failPublication) {
                    this.failPublication = false;
                    throw new Error('publication failed');
                }
                super.preEmit();
            }
        }
        let calls = 0;
        const resource = new ThrowingResource(async () => ++calls);
        const old = {status: EResourceStatus.Idle, data: 1, error: undefined, updatedAt: 3};
        Object.defineProperty(old, 'status', {
            value: EResourceStatus.Idle, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(old);
        resource.failPublication = true;
        await expect(resource.load('first')).rejects.toThrow('publication failed');
        expect(calls).toBe(0);
        expect(resource.getData()).toBe(old);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(resource.snapshot().key).toBeUndefined();
        await resource.reload();
        expect(calls).toBe(0);
        await resource.load('second');
        expect(resource.getData().data).toBe(1);
        expect(resource.snapshot().key).toBe(JSON.stringify('second'));
    });

    test('readonly replay supersession leaves the synchronous abort listener in charge', async () => {
        const first = deferred<number>();
        const replacement = deferred<number>();
        const calls: string[] = [];
        let resource!: ResourceCarburetor<number, string>;
        resource = new ResourceCarburetor<number, string>((key, signal) => {
            calls.push(key);
            if (key === 'first') {
                signal.addEventListener('abort', () => { void resource.load('replacement'); });
                return first.promise;
            }
            return replacement.promise;
        });
        const history = new CarburetorHistory(resource);
        const pending = {status: EResourceStatus.Pending, data: 4, error: undefined, updatedAt: 7};
        Object.defineProperty(pending, 'status', {
            value: EResourceStatus.Pending, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(pending);
        history.undo();
        history.redo();
        const stale = resource.load('first');
        await expect(resource.load('interrupted')).rejects.toMatchObject({name: 'AbortError'});
        expect(calls).toEqual(['first', 'replacement']);
        first.resolve(88);
        await stale;
        replacement.resolve(33);
        await flush();
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe(33);
        expect(resource.snapshot().key).toBe(JSON.stringify('replacement'));
        history.disconnect();
    });

    test('nested opaque payloads remain live while native root aliases stay owned', async () => {
        class Payload {
            constructor(public readonly value: number) {}
        }
        const original = new Payload(1);
        const result = new Payload(2);
        const map = new Map<object, object>();
        const payload = {item: original, map};
        const resource = new ResourceCarburetor<Payload | typeof payload, string>(async () => result);
        const state = {status: EResourceStatus.Idle, data: payload, error: undefined, updatedAt: 7};
        map.set(state, payload);
        map.set(payload, state);
        for (const field of ['status', 'data', 'error', 'updatedAt'] as const) {
            Object.defineProperty(state, field, {
                value: state[field], writable: false, configurable: false, enumerable: true,
            });
        }
        resource.setData(state);
        const request = resource.load('new');
        const pending = resource.getData();
        const currentPayload = pending.data as typeof payload;
        expect(currentPayload.item).toBe(original);
        expect(currentPayload.map.get(pending)).toBe(currentPayload);
        expect(currentPayload.map.get(currentPayload)).toBe(pending);
        await request;
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe(result);
        expect(state.data).toBe(payload);
        expect(state.status).toBe(EResourceStatus.Idle);
    });

    test('a patch observer supersedes deferred readonly Pending before the old loader', async () => {
        const gate = deferred<number>();
        const calls: string[] = [];
        const resource = new ResourceCarburetor<number, string>(key => {
            calls.push(key);
            return gate.promise;
        });
        const idle = {status: EResourceStatus.Idle, data: 1, error: undefined, updatedAt: 7};
        Object.defineProperty(idle, 'status', {
            value: EResourceStatus.Idle, writable: false, configurable: false, enumerable: true,
        });
        resource.setData(idle);
        let replaced = false;
        const disconnect = resource.attachPatchListener({
            patch() {
                if (!replaced) {
                    replaced = true;
                    void resource.load('replacement');
                }
            },
        });
        let suspended!: Promise<void>;
        try {
            resource.suspend('old');
        } catch (thrown) {
            suspended = thrown as Promise<void>;
        }
        await expect(suspended).rejects.toMatchObject({name: 'AbortError'});
        expect(calls).toEqual(['replacement']);
        gate.resolve(99);
        await flush();
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe(99);
        expect(resource.snapshot().key).toBe(JSON.stringify('replacement'));
        disconnect();
    });
});
