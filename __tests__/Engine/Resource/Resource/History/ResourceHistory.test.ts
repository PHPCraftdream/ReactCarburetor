import {
    CarburetorHistory, ComponentUpdateThrottle, connectDevTools, EResourceStatus, IDevToolsConnection,
    IStorageLike, persist, ResourceCarburetor,
} from '@/Carburetor';

const caught = (read: () => unknown): unknown => {
    try {
        read();
    } catch (error: unknown) {
        return error;
    }

    return undefined;
};

describe('resource wire identity and history', () => {
    test('undo/redo restores a successful answer for its own key, and a new load branches history', async () => {
        const calls: string[] = [];
        const resource = new ResourceCarburetor<string, string>(async key => {
            calls.push(key);
            return `answer-${key}`;
        });
        const history = new CarburetorHistory(resource);

        await resource.load('a');
        expect(resource.getData()).not.toHaveProperty('key');
        expect(history.undo()).toBe(true);
        // The pending entry cannot be replayed as a live request.
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(history.redo()).toBe(true);
        expect(resource.snapshot().key).toBe(JSON.stringify('a'));
        expect(resource.suspend('a')).toBe('answer-a');
        expect(calls).toEqual(['a']);

        expect(history.undo()).toBe(true);
        await resource.load('b');
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(resource.snapshot().key).toBe(JSON.stringify('b'));
        expect(resource.suspend('b')).toBe('answer-b');
        expect(calls).toEqual(['a', 'b']);

        const pending = caught(() => resource.suspend('a'));
        expect(pending).toBeInstanceOf(Promise);
        expect(calls).toEqual(['a', 'b', 'a']);
        await (pending as Promise<void>);
        history.disconnect();
    });

    test('a load started by a replay subscriber is a fresh wire-history branch', async () => {
        const calls: string[] = [];
        const resource = new ResourceCarburetor<string, string>(async key => {
            calls.push(key);
            return `answer-${key}`;
        });
        const history = new CarburetorHistory(resource);
        await resource.load('a');
        let replacement: Promise<void> | undefined;
        const subscription = resource.subscribe(() => {
            if (resource.getData().status === EResourceStatus.Idle && replacement === undefined) {
                replacement = resource.load('b');
            }
        });

        expect(history.undo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Pending);
        expect(history.canRedo()).toBe(false);
        expect(replacement).toBeDefined();
        await replacement;
        expect(resource.snapshot().key).toBe(JSON.stringify('b'));
        expect(resource.suspend('b')).toBe('answer-b');
        expect(calls).toEqual(['a', 'b']);
        expect(history.undo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(history.redo()).toBe(true);
        expect(resource.snapshot().key).toBe(JSON.stringify('b'));
        expect(resource.suspend('b')).toBe('answer-b');
        expect(calls).toEqual(['a', 'b']);
        resource.unsubscribe(subscription);
        history.disconnect();
    });

    test('an abort listener that supersedes replay owns its new settled wire answer', async () => {
        const resource = new ResourceCarburetor<string, string>(async (key, signal) => {
            if (key === 'slow') {
                signal.addEventListener('abort', () => {
                    resource.restore({
                        status: EResourceStatus.Success,
                        data: 'answer-b',
                        error: undefined,
                        updatedAt: 1,
                        key: JSON.stringify('b'),
                    });
                });
                return new Promise<string>(() => {});
            }
            return `answer-${key}`;
        });
        const history = new CarburetorHistory(resource);
        await resource.load('a');
        void resource.load('slow');
        expect(resource.getData().status).toBe(EResourceStatus.Pending);

        expect(history.undo()).toBe(true);
        expect(resource.snapshot().key).toBe(JSON.stringify('b'));
        expect(resource.suspend('b')).toBe('answer-b');
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(history.redo()).toBe(true);
        expect(resource.snapshot().key).toBe(JSON.stringify('b'));
        expect(resource.suspend('b')).toBe('answer-b');
        history.disconnect();
    });

    test('a deferred abort-listener publication retains its own history branch', async () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const resource = new ResourceCarburetor<string, string>(async (key, signal) => {
            if (key === 'slow') {
                signal.addEventListener('abort', () => resource.restore({
                    status: EResourceStatus.Success, data: 'answer-b',
                    error: undefined, updatedAt: 1, key: JSON.stringify('b'),
                }));
                return new Promise<string>(() => {});
            }
            return `answer-${key}`;
        }, throttle);
        const history = new CarburetorHistory(resource);
        await resource.load('a');
        throttle.flush();
        void resource.load('slow');
        throttle.flush();

        expect(history.undo()).toBe(true);
        expect(resource.snapshot().key).toBe(JSON.stringify('b'));
        throttle.flush();
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        throttle.flush();
        expect(resource.getData().status).toBe(EResourceStatus.Idle);
        expect(history.redo()).toBe(true);
        throttle.flush();
        expect(resource.suspend('b')).toBe('answer-b');
        history.disconnect();
    });

    test('undo/redo preserves the key of a failed answer and never serves it to other arguments', async () => {
        const calls: string[] = [];
        const resource = new ResourceCarburetor<string, string>(async key => {
            calls.push(key);
            if (key === 'a') {
                throw new Error('offline');
            }

            return 'online';
        });
        const history = new CarburetorHistory(resource);
        await resource.load('a');
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(resource.snapshot().key).toBe(JSON.stringify('a'));
        expect(caught(() => resource.suspend('a'))).toMatchObject({message: 'offline'});
        expect(calls).toEqual(['a']);
        const pending = caught(() => resource.suspend('b'));
        expect(pending).toBeInstanceOf(Promise);
        expect(calls).toEqual(['a', 'b']);
        await (pending as Promise<void>);
        history.disconnect();
    });

    test('opaque resource history preserves array truncation without widening unrelated reads', async () => {
        class ArrayResource extends ResourceCarburetor<number[], string> {
            /** Publishes a native array truncation through the draft. */
            public truncate(length: number): void {
                (this.draft.data as number[]).length = length;
                this.emitUpdate();
            }

            /** Replaces a trackable answer with another of the same kind. */
            public replace(value: number[]): void {
                this.draft.data = value;
                this.emitUpdate();
            }
        }
        const resource = new ArrayResource(async () => [1, 2, 3, 4]);
        const history = new CarburetorHistory(resource);
        await resource.load('a');
        let firstWakes = 0;
        const stopFirst = resource.watch(state => state.data?.[0], () => { firstWakes++; });

        resource.truncate(2);
        expect(resource.getData().data).toEqual([1, 2]);
        expect(firstWakes).toBe(0);
        expect(history.undo()).toBe(true);
        expect(resource.getData().data).toEqual([1, 2, 3, 4]);
        expect(resource.suspend('a')).toEqual([1, 2, 3, 4]);
        expect(history.redo()).toBe(true);
        expect(resource.getData().data).toEqual([1, 2]);
        expect(firstWakes).toBe(0);

        resource.replace([1, 2, 5]);
        expect(history.undo()).toBe(true);
        expect(resource.getData().data).toEqual([1, 2]);
        expect(history.redo()).toBe(true);
        expect(resource.suspend('a')).toEqual([1, 2, 5]);
        expect(firstWakes).toBe(0);
        stopFirst();
        history.disconnect();
    });

    test.each([
        {failure: false, coalesce: false}, {failure: false, coalesce: true},
        {failure: true, coalesce: false}, {failure: true, coalesce: true},
    ])('key-only $failure failure, coalesce=$coalesce publishes one wire update', async ({failure, coalesce}) => {
        const resource = new ResourceCarburetor<string, string>(async () => {
            if (failure) {
                throw new Error('offline');
            }

            return 'same';
        });
        await resource.load('a');
        const original = resource.snapshot();
        const changed = {...original, key: JSON.stringify('b')};
        const entries = new Map<string, string>();
        let writes = 0;
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { writes++; entries.set(key, value); },
            removeItem: key => { entries.delete(key); },
        };
        const stopPersist = persist(resource, {key: 'slot', storage, coalesce});
        const sends: unknown[] = [];
        const connection: IDevToolsConnection = {
            init: () => undefined,
            send: (_action, state) => { sends.push(state); },
            subscribe: () => () => undefined,
        };
        const stopDevTools = connectDevTools({slot: resource}, {extension: {connect: () => connection}});
        let wakes = 0;
        const wakeId = resource.subscribe(() => { wakes++; });
        const before = resource.getVersion();

        resource.restore(changed);
        expect(resource.getVersion()).toBe(before + 1);
        expect(wakes).toBe(1);
        expect(sends).toEqual([{slot: changed}]);
        expect(resource.getData()).not.toHaveProperty('key');
        if (!coalesce) {
            expect(writes).toBe(1);
            expect(JSON.parse(entries.get('slot') as string)).toEqual(changed);
        }
        resource.restore(changed);
        expect(resource.getVersion()).toBe(before + 1);
        expect(wakes).toBe(1);
        expect(sends).toHaveLength(1);
        await Promise.resolve();
        expect(writes).toBe(1);
        expect(JSON.parse(entries.get('slot') as string)).toEqual(changed);

        const freshCalls: string[] = [];
        const fresh = new ResourceCarburetor<string, string>(async key => {
            freshCalls.push(key);
            return 'loaded';
        });
        fresh.fromJSON(JSON.parse(entries.get('slot') as string));
        if (failure) {
            expect(caught(() => fresh.suspend('b'))).toMatchObject({message: 'offline'});
        } else {
            expect(fresh.suspend('b')).toBe('same');
        }
        expect(freshCalls).toEqual([]);

        resource.restore(original);
        expect(resource.getVersion()).toBe(before + 2);
        expect(wakes).toBe(2);
        expect(sends).toEqual([{slot: changed}, {slot: original}]);
        stopPersist(); // Flushes coalesced updates as well.
        expect(writes).toBe(2);
        expect(JSON.parse(entries.get('slot') as string)).toEqual(original);
        stopDevTools();
        resource.unsubscribe(wakeId);
    });
});
