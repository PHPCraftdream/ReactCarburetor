import {Carburetor, IStorageLike, persist} from '@/Carburetor';

class MemoryStorage implements IStorageLike {
    /** The stored entries, keyed like the storage adapter sees them. */
    public entries = new Map<string, string>();
    /** The keys of every successful setItem, in order. */
    public writtenKeys: string[] = [];

    /** Reads one stored entry.
     *
     * @param key - the storage key to read.
     */
    public getItem(key: string): string | null {
        return this.entries.get(key) ?? null;
    }

    /** Stores one entry.
     *
     * @param key - the storage key to write.
     * @param value - the serialized value to keep.
     */
    public setItem(key: string, value: string): void {
        this.writtenKeys.push(key);
        this.entries.set(key, value);
    }

    /** Drops one stored entry.
     *
     * @param key - the storage key to remove.
     */
    public removeItem(key: string): void {
        this.entries.delete(key);
    }
}

class NegativeCounter extends Carburetor<{a: {n: number}; b: {n: number}}> {
    /** Rejects a restored negative counter, keeping the current state.
     *
     * @param data - the parsed stored state about to be installed.
     */
    public restore(data: {a: {n: number}; b: {n: number}}): void {
        if (data.a.n < 0) {
            throw new Error('negative counter');
        }

        super.restore(data);
    }
}

class NegativeACounter extends Carburetor<{a: {n: number}}> {
    /** Rejects a restored negative counter, keeping the current state.
     *
     * @param data - the parsed stored state about to be installed.
     */
    public restore(data: {a: {n: number}}): void {
        if (data.a.n < 0) {
            throw new Error('negative counter');
        }

        super.restore(data);
    }
}

const settle = (): Promise<void> => new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)));

/**
 * Replaces Date.now and the timer functions persist schedules with a hand-advanced fake
 * clock, so a throttle window cannot depend on process speed or the system clock. Every
 * caller must invoke restore() in a finally block.
 */
const useFakeClock = (): {advance: (ms: number) => void; restore: () => void; scheduled: () => number} => {
    const realDateNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    let fakeNow = 1_000_000;
    let timers: Array<{callback: () => void; cancelled: boolean}> = [];

    Date.now = (): number => fakeNow;
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
        void delay;
        timers.push({callback, cancelled: false});

        return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((handle: unknown) => {
        const scheduledTimer = timers[Number(handle) - 1];

        if (scheduledTimer) scheduledTimer.cancelled = true;
    }) as typeof clearTimeout;

    return {
        advance: ms => {
            fakeNow += ms;
            const dueTimers = timers.filter(timer => !timer.cancelled);
            timers = [];
            dueTimers.forEach(timer => timer.callback());
        },
        restore: () => {
            Date.now = realDateNow;
            globalThis.setTimeout = realSetTimeout;
            globalThis.clearTimeout = realClearTimeout;
        },
        scheduled: () => timers.filter(timer => !timer.cancelled).length,
    };
};

describe('persist partition storage failures', () => {
    test('a failed partition write is retried by the disposer without new changes', async () => {
        const quota = new Error('quota exceeded');
        const entries = new Map<string, string>();
        const errors: unknown[] = [];
        let failB = true;
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => {
                if (failB && key === 'app.b') {
                    throw quota;
                }

                entries.set(key, value);
            },
            removeItem: key => { entries.delete(key); },
        };

        const store = new Carburetor({a: {n: 1}, b: {n: 1}});
        const dispose = persist(store, {
            key: 'app', storage, partitions: ['a', 'b'], onError: error => { errors.push(error); },
        });

        // The sealing flush: app.a lands, app.b hits the quota.
        store.setData({a: {n: 2}, b: {n: 2}});
        await settle();

        expect(errors).toEqual([quota]);
        expect(entries.get('app.a')).toEqual(JSON.stringify({n: 2}));
        expect(entries.has('app.b')).toBe(false);

        // The quota is gone. Disposing without any new change still retries app.b.
        failB = false;
        dispose();

        expect(entries.get('app.a')).toEqual(JSON.stringify({n: 2}));
        expect(entries.get('app.b')).toEqual(JSON.stringify({n: 2}));
        expect(errors).toEqual([quota]);
    });

    test('a failed synchronous partition write is retried on the next notification', () => {
        const quota = new Error('quota exceeded');
        const entries = new Map<string, string>();
        const errors: unknown[] = [];
        let failB = true;
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => {
                if (failB && key === 'app.b') {
                    throw quota;
                }

                entries.set(key, value);
            },
            removeItem: key => { entries.delete(key); },
        };

        const store = new Carburetor({a: {n: 1}, b: {n: 1}});
        const dispose = persist(store, {
            key: 'app', storage, partitions: ['a', 'b'], coalesce: false,
            onError: error => { errors.push(error); },
        });

        // The sealing flush attempts both partitions; app.b fails and is reported.
        store.setData({a: {n: 2}, b: {n: 2}});

        expect(entries.get('app.a')).toEqual(JSON.stringify({n: 2}));
        expect(entries.has('app.b')).toBe(false);
        const failedReports = errors.length;
        expect(failedReports).toBeGreaterThanOrEqual(1);

        // Only app.a changes, yet the failed app.b must be retried by the same notification.
        failB = false;
        store.setData({a: {n: 3}, b: {n: 2}});

        expect(entries.get('app.a')).toEqual(JSON.stringify({n: 3}));
        expect(entries.get('app.b')).toEqual(JSON.stringify({n: 2}));
        expect(errors.length).toEqual(failedReports);

        dispose();
    });

    test('a failed synchronous partition removal is retried on the next notification', () => {
        const quota = new Error('quota exceeded');
        const entries = new Map<string, string>();
        const errors: unknown[] = [];
        let failRemove = true;
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
            removeItem: key => {
                if (failRemove && key === 'app.b') {
                    throw quota;
                }

                entries.delete(key);
            },
        };

        const store = new Carburetor({a: {n: 1}, b: {n: 1}});
        const dispose = persist(store, {
            key: 'app', storage, partitions: ['a', 'b'], coalesce: false,
            onError: error => { errors.push(error); },
        });

        store.setData({a: {n: 2}, b: {n: 1}});

        expect(entries.has('app.b')).toBe(true);

        // Branch b disappears from the state; its storage entry cannot be removed yet.
        store.setData({a: {n: 3}});

        expect(errors).toEqual([quota]);
        expect(entries.has('app.b')).toBe(true);

        // The next notification must retry the removal even though only app.a changed.
        failRemove = false;
        store.setData({a: {n: 4}});

        expect(entries.has('app.b')).toBe(false);
        expect(errors).toEqual([quota]);

        dispose();
    });

    test('a rejected composite restore keeps every partition entry', () => {
        const entries = new Map<string, string>();
        entries.set('app.a', JSON.stringify({n: -1}));
        entries.set('app.b', JSON.stringify({n: 42}));
        const errors: unknown[] = [];
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
            removeItem: key => { entries.delete(key); },
        };

        const store = new NegativeCounter({a: {n: 0}, b: {n: 0}});
        const dispose = persist(store, {
            key: 'app', storage, partitions: ['a', 'b'], onError: error => { errors.push(error); },
        });

        // The guilty partition is unknown, so nothing is deleted: the next connection with a
        // fixed model still finds both entries.
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toBe('negative counter');
        expect(entries.get('app.a')).toEqual(JSON.stringify({n: -1}));
        expect(entries.get('app.b')).toEqual(JSON.stringify({n: 42}));

        dispose();
    });

    test('a rejected composite restore reports that the stored data is kept', () => {
        const entries = new Map<string, string>();
        entries.set('app.a', JSON.stringify({n: -1}));
        entries.set('app.b', JSON.stringify({n: 42}));
        const reported: string[] = [];
        const original = console.error;
        console.error = (message: string) => { reported.push(message); };
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
            removeItem: key => { entries.delete(key); },
        };

        try {
            const store = new NegativeCounter({a: {n: 0}, b: {n: 0}});
            const dispose = persist(store, {key: 'app', storage, partitions: ['a', 'b']});

            expect(reported).toHaveLength(1);
            expect(reported[0]).toContain('the stored data is kept');
            expect(reported[0]).toContain('negative counter');
            expect(entries.get('app.a')).toEqual(JSON.stringify({n: -1}));
            expect(entries.get('app.b')).toEqual(JSON.stringify({n: 42}));

            dispose();
        } finally {
            console.error = original;
        }
    });

    test('a rejected single-partition restore removes its known entry and reports it', () => {
        const entries = new Map<string, string>();
        entries.set('solo.a', JSON.stringify({n: -1}));
        const errors: unknown[] = [];
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
            removeItem: key => { entries.delete(key); },
        };

        const store = new NegativeACounter({a: {n: 0}});
        const dispose = persist(store, {
            key: 'solo', storage, partitions: ['a'], onError: error => { errors.push(error); },
        });

        // With one stored partition the culprit is known: the old removal contract holds.
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toBe('negative counter');
        expect(entries.has('solo.a')).toBe(false);

        dispose();
    });

    test('a rejected restore keeps the stored entry when several partitions are configured', () => {
        const entries = new Map<string, string>();
        entries.set('multi.a', JSON.stringify({n: -1}));
        const errors: unknown[] = [];
        const storage: IStorageLike = {
            getItem: key => entries.get(key) ?? null,
            setItem: (key, value) => { entries.set(key, value); },
            removeItem: key => { entries.delete(key); },
        };

        const dispose = persist(new NegativeACounter({a: {n: 0}, b: {n: 0}}), {
            key: 'multi', storage, partitions: ['a', 'b'], onError: error => { errors.push(error); },
        });

        expect(errors).toHaveLength(1);
        expect(entries.get('multi.a')).toBe(JSON.stringify({n: -1}));

        dispose();
    });

    test('disposal does not reschedule the throttle timer', async () => {
        const storage = new MemoryStorage();
        const store = new Carburetor({a: {n: 1}, b: {n: 1}});
        const clock = useFakeClock();

        try {
            const dispose = persist(store, {
                key: 'app', storage, partitions: ['a', 'b'], throttleMs: 60000,
            });

            store.setData({a: {n: 2}, b: {n: 1}});
            await settle();

            expect(storage.writtenKeys).toEqual(['app.a', 'app.b']);

            // The second change lands inside the window and is disposed before its microtask.
            store.setData({a: {n: 3}, b: {n: 1}});
            dispose();
            await settle();

            expect(storage.writtenKeys).toEqual(['app.a', 'app.b', 'app.a']);
            expect(clock.scheduled()).toEqual(0);

            // The detached store can no longer create writes or timers.
            store.setData({a: {n: 4}, b: {n: 1}});
            clock.advance(60001);

            expect(storage.writtenKeys).toEqual(['app.a', 'app.b', 'app.a']);
            expect(clock.scheduled()).toEqual(0);
        } finally {
            clock.restore();
        }
    });
});
