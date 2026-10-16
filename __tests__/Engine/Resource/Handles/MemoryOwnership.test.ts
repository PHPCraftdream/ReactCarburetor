import {CarburetorHistory, EResourceStatus, ResourceCarburetor} from '@/Carburetor';
import {resourceStatusFlags} from '@/Carburetor/Resource/Status/resourceStatusFlags';
import {deferred, flush} from '../Resource/Keys/helpers';

describe('ResourceCarburetor memory-hit owns the slot', () => {
    test('load from memory ignores the late answer of a different in-flight key', async () => {
        const d = deferred<string>();
        const signals: AbortSignal[] = [];
        const resource = new ResourceCarburetor<string, [string]>(
            async (key, signal) => {
                signals.push(signal);
                return key === 'b' ? d.promise : `answer-${key}`;
            }
        );

        await resource.load('a');

        // 'b' hangs; a memory hit on 'a' must take ownership away from it.
        const hanging = resource.load('b');
        expect(resource.getData().status).toBe(EResourceStatus.Pending);
        const fromMemory = resource.load('a');
        expect(signals[1]!.aborted).toBe(true);
        d.resolve('answer-b');
        await Promise.allSettled([fromMemory, hanging]);
        await flush();

        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('answer-a');
    });

    test('suspend from memory ignores the late answer of a different in-flight key', async () => {
        const d = deferred<string>();
        const resource = new ResourceCarburetor<string, [string]>(
            async key => key === 'b' ? d.promise : `answer-${key}`
        );

        await resource.load('a');
        const hanging = resource.load('b'); // hangs
        const value = resource.suspend('a'); // memory hit during render
        d.resolve('answer-b');
        await Promise.allSettled([hanging]);
        await flush();

        expect(value).toBe('answer-a');
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('answer-a');
    });

    test('memory hit publishes through an owned readonly replay without mutating held endpoints', async () => {
        const d = deferred<string>();
        const resource = new ResourceCarburetor<string, [string]>(
            async key => key === 'b' ? d.promise : `answer-${key}`
        );
        const history = new CarburetorHistory(resource);

        await resource.load('a'); // memory remembers 'a'
        const pending = {...resourceStatusFlags(EResourceStatus.Pending),
            status: EResourceStatus.Pending, data: 'old', error: 'old', updatedAt: 7};
        for (const field of ['status', 'data', 'error', 'updatedAt'] as const) {
            Object.defineProperty(pending, field, {
                value: pending[field], writable: false, configurable: false, enumerable: true,
            });
        }
        resource.setData(pending);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);

        // The replayed state is locked; the memory hit on 'a' must publish a fresh graph.
        const replayed = resource.getData();
        const seenKeys: unknown[] = [];
        const id = resource.subscribe(() => {
            seenKeys.push(resource.snapshot().key);
        });
        const fromMemory = resource.load('a');
        resource.unsubscribe(id);
        // A synchronous subscriber already sees the answer's key.
        expect(seenKeys).toEqual(['"a"']);
        await fromMemory;
        d.resolve('answer-b');
        await flush();

        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('answer-a');
        expect(resource.getData()).not.toBe(replayed);
        expect(replayed.status).toBe(EResourceStatus.Idle);
        expect(replayed.data).toBe('old');
        expect(replayed.updatedAt).toBe(7);
        expect(Object.getOwnPropertyDescriptor(replayed, 'updatedAt')?.writable).toBe(false);
        history.disconnect();
    });

    test('suspend from memory publishes after an owned readonly replay', async () => {
        const d = deferred<string>();
        const resource = new ResourceCarburetor<string, [string]>(
            async key => key === 'b' ? d.promise : `answer-${key}`
        );
        const history = new CarburetorHistory(resource);

        await resource.load('a');
        const pending = {...resourceStatusFlags(EResourceStatus.Pending),
            status: EResourceStatus.Pending, data: 'old', error: 'old', updatedAt: 7};
        for (const field of ['status', 'data', 'error', 'updatedAt'] as const) {
            Object.defineProperty(pending, field, {
                value: pending[field], writable: false, configurable: false, enumerable: true,
            });
        }
        resource.setData(pending);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);

        const replayed = resource.getData();
        const value = resource.suspend('a');
        d.resolve('answer-b');
        await flush();

        expect(value).toBe('answer-a');
        expect(resource.getData().status).toBe(EResourceStatus.Success);
        expect(resource.getData().data).toBe('answer-a');
        expect(resource.getData()).not.toBe(replayed);
        expect(replayed.data).toBe('old');
        expect(replayed.updatedAt).toBe(7);
        expect(Object.getOwnPropertyDescriptor(replayed, 'updatedAt')?.writable).toBe(false);
        history.disconnect();
    });

    test('load of a key being refreshed joins the refresh instead of serving memory', async () => {
        const d = deferred<string>();
        const signals: AbortSignal[] = [];
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>(async (key, signal) => {
            signals.push(signal);
            calls += 1;
            return calls === 3 ? d.promise : `answer-${key}-${calls}`;
        });

        await resource.load('a');
        await resource.load('b');
        const refreshing = resource.refresh('a');
        const joined = resource.load('a');
        expect(signals[2]!.aborted).toBe(false);
        d.resolve('answer-a-fresh');
        await Promise.all([refreshing, joined]);

        expect(resource.getData().data).toBe('answer-a-fresh');
    });

    test('suspend of a key being refreshed throws the refresh instead of serving memory', async () => {
        const d = deferred<string>();
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>(async (key) => {
            calls += 1;
            return calls === 3 ? d.promise : `answer-${key}-${calls}`;
        });

        await resource.load('a');
        await resource.load('b');
        const refreshing = resource.refresh('a');
        let thrown: unknown;
        try {
            resource.suspend('a');
        } catch (error: unknown) {
            thrown = error;
        }
        expect(thrown).toBe(refreshing);
        d.resolve('answer-a-fresh');
        await refreshing;
        expect(resource.getData().data).toBe('answer-a-fresh');
    });

    test('a failed refresh evicts the key: the next load re-requests', async () => {
        const script = ['a-1', 'fail', 'a-2'];
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>(async (key: string) => {
            calls += 1;
            const next = script.shift()!;
            if (next === 'fail') throw new Error(`failed-${key}`);
            return next;
        });

        await resource.load('a');
        await resource.refresh('a').catch(() => undefined); // failed
        await resource.load('a');

        expect(calls).toBe(3);
        expect(resource.getData().data).toBe('a-2');
        expect(resource.getData().status).toBe(EResourceStatus.Success);
    });

    test('after a failed refresh, switching keys away and back re-requests instead of serving memory', async () => {
        const script = ['a-1', 'b-1', 'fail', 'c-1', 'a-2'];
        let calls = 0;
        const resource = new ResourceCarburetor<string, [string]>(async (key: string) => {
            calls += 1;
            const next = script.shift()!;
            if (next === 'fail') throw new Error(`failed-${key}`);
            return next;
        });

        await resource.load('a');
        await resource.load('b');
        await resource.refresh('a').catch(() => undefined); // failed
        await resource.load('c');
        let served: unknown;
        let thrown: unknown;
        try {
            served = resource.suspend('a');
        } catch (error: unknown) {
            thrown = error;
        }

        // The stale memory answer must not be served; a fresh request starts.
        expect(served).toBeUndefined();
        expect(thrown).toBeInstanceOf(Promise);
        await (thrown as Promise<unknown>);
        await flush();

        expect(resource.getData().data).toBe('a-2');
        expect(calls).toBe(5);
    });

    test('a failed refresh keeps the stored-failure rethrow for its own key', async () => {
        const script = ['a-1', 'fail'];
        const resource = new ResourceCarburetor<string, [string]>(async (key: string) => {
            const next = script.shift()!;
            if (next === 'fail') throw new Error(`failed-${key}`);
            return next;
        });

        await resource.load('a');
        await resource.refresh('a').catch(() => undefined); // failed
        let thrown: unknown;
        try {
            resource.suspend('a');
        } catch (error: unknown) {
            thrown = error;
        }

        expect(thrown).not.toBeInstanceOf(Promise);
        expect((thrown as Error).message).toBe('failed-a');
    });

    test('a memory hit that only changes the key still publishes once (load)', async () => {
        const realNow = Date.now;
        Date.now = () => 5_000;
        try {
            const resource = new ResourceCarburetor<string, [string]>(async () => 'same');
            const history = new CarburetorHistory(resource);
            await resource.load('a');
            await resource.load('b'); // identical answer, same frozen timestamp

            const seenKeys: unknown[] = [];
            const id = resource.subscribe(() => {
                seenKeys.push(resource.snapshot().key);
            });
            const versionBefore = resource.getVersion();
            resource.load('a'); // memory hit that only changes the key
            resource.unsubscribe(id);

            expect(seenKeys).toEqual(['"a"']);
            expect(resource.getVersion()).toBe(versionBefore + 1);
            expect(history.undo()).toBe(true);
            expect(resource.snapshot().key).toBe('"b"');
            expect(history.redo()).toBe(true);
            expect(resource.snapshot().key).toBe('"a"');
            history.disconnect();
        } finally {
            Date.now = realNow;
        }
    });

    test('a memory hit that only changes the key still publishes once (suspend)', async () => {
        const realNow = Date.now;
        Date.now = () => 5_000;
        try {
            const resource = new ResourceCarburetor<string, [string]>(async () => 'same');
            const history = new CarburetorHistory(resource);
            await resource.load('a');
            await resource.load('b'); // identical answer, same frozen timestamp

            const seenKeys: unknown[] = [];
            const id = resource.subscribe(() => {
                seenKeys.push(resource.snapshot().key);
            });
            const versionBefore = resource.getVersion();
            const value = resource.suspend('a'); // memory hit in render position
            // Render must not notify: nothing is published synchronously.
            expect(seenKeys).toEqual([]);
            await flush(); // publication is deferred, so unsubscribe only after the flush
            resource.unsubscribe(id);

            expect(value).toBe('same');
            expect(seenKeys).toEqual(['"a"']);
            expect(resource.getVersion()).toBe(versionBefore + 1);
            expect(history.undo()).toBe(true);
            expect(resource.snapshot().key).toBe('"b"');
            expect(history.redo()).toBe(true);
            expect(resource.snapshot().key).toBe('"a"');
            history.disconnect();
        } finally {
            Date.now = realNow;
        }
    });

    test('a key-only memory hit publishes through an owned readonly replay', async () => {
        const realNow = Date.now;
        Date.now = () => 5_000;
        try {
            let calls = 0;
            const resource = new ResourceCarburetor<string, [string]>(async () => {
                calls += 1;
                return 'same';
            });
            // Prime the memory first: the locked state must be hit by memory, not a request.
            await resource.load('a');
            const locked = {...resourceStatusFlags(EResourceStatus.Success),
                status: EResourceStatus.Success, data: 'same', error: undefined, updatedAt: 5_000};
            for (const field of ['status', 'data', 'error', 'updatedAt'] as const) {
                Object.defineProperty(locked, field, {
                    value: locked[field], writable: false, configurable: false, enumerable: true,
                });
            }
            resource.setData(locked);

            const seenKeys: unknown[] = [];
            const id = resource.subscribe(() => {
                seenKeys.push(resource.snapshot().key);
            });
            const versionBefore = resource.getVersion();
            await resource.load('a'); // memory hit against the locked state
            resource.unsubscribe(id);
            await flush();

            // Only the priming load requested: the locked-state hit must serve from memory.
            expect(calls).toBe(1);
            expect(seenKeys).toEqual(['"a"']);
            expect(resource.getVersion()).toBe(versionBefore + 1);
            expect(resource.getData()).not.toBe(locked);
        } finally {
            Date.now = realNow;
        }
    });
});
