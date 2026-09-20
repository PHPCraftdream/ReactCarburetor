import {ResourceCarburetor} from "../lib/src/Carburetor";

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

        expect(resource.getData().status).toEqual('idle');

        const loading = resource.load(undefined);
        expect(resource.getData().status).toEqual('pending');

        gate.resolve('loaded');
        await loading;

        expect(resource.getData().status).toEqual('success');
        expect(resource.getData().data).toEqual('loaded');
        expect(resource.getData().error).toEqual(undefined);
        expect(typeof resource.getData().updatedAt).toEqual('number');
    });

    test('records a failure as a serializable message and keeps the raw error', async () => {
        const failure = new Error('nope');
        const resource = new ResourceCarburetor<string>(() => Promise.reject(failure));

        await resource.load(undefined);

        expect(resource.getData().status).toEqual('error');
        expect(resource.getData().error).toEqual('nope');
        expect(resource.getLastError()).toBe(failure);
        expect(JSON.stringify(resource.getData())).toContain('nope');
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

    test('abort leaves the resource pending without settling it', async () => {
        const gate = deferred<string>();
        const resource = new ResourceCarburetor<string>(() => gate.promise);

        const loading = resource.load(undefined);
        resource.abort();

        gate.resolve('ignored');
        await loading;
        await flush();

        expect(resource.getData().status).toEqual('pending');
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
});
