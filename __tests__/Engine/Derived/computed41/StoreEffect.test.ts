import {Carburetor, computed, diagnostics, storeEffect} from '@/Carburetor';
import * as Engine from '@/Engine';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';

interface ICounter {count: number; label: string}

const setCount = (draft: ICounter, count: number): void => { draft.count = count; };
const setLabel = (draft: ICounter, label: string): void => { draft.label = label; };
const selectCount = (data: ICounter): number => data.count;

class Counter extends Carburetor<ICounter> {
    public set(count: number): void { this.update(setCount, count); }
    public rename(label: string): void { this.update(setLabel, label); }
    public subscriberCount(): number { return Object.keys(this[S.subscribers]).length; }
}

describe('storeEffect', () => {
    test('runs now and after each change of the selection, cleaning up the run before', () => {
        const store = new Counter({count: 1, label: 'a'});
        const seen: string[] = [];
        const stop = storeEffect(store, selectCount, (count, previous) => {
            seen.push(`run ${count} after ${String(previous)}`);
            return (): void => { seen.push(`clean ${count}`); };
        });

        store.rename('b');
        store.set(2);
        stop();
        store.set(3);

        expect(seen).toEqual(['run 1 after undefined', 'clean 1', 'run 2 after 1', 'clean 2']);
    });

    test('follows a computed over several stores', () => {
        const left = new Counter({count: 1, label: 'l'});
        const right = new Counter({count: 2, label: 'r'});
        const sum = computed<number>((read) => read(left).count + read(right).count);
        const seen: number[] = [];
        const stop = storeEffect(sum, (value) => { seen.push(value); });

        left.set(5);
        right.rename('x');
        right.set(4);
        stop();
        left.set(0);

        expect(seen).toEqual([3, 7, 9]);
    });

    test('a change the effect itself causes is followed', () => {
        const store = new Counter({count: 0, label: 'a'});
        const seen: number[] = [];
        const stop = storeEffect(store, selectCount, (count) => {
            seen.push(count);
            if (count < 2) store.set(count + 1);
        });

        expect(seen).toEqual([0, 1, 2]);
        stop();
    });

    test('a disposer called twice runs the last cleanup once', () => {
        const store = new Counter({count: 0, label: 'a'});
        let cleaned = 0;
        const stop = storeEffect(store, selectCount, () => (): void => { cleaned++; });

        stop();
        stop();
        expect(cleaned).toBe(1);
    });

    test('a first run that throws releases the watch before the error leaves', () => {
        const store = new Counter({count: 0, label: 'a'});
        const failure = new Error('effect failed');

        expect(() => storeEffect(store, selectCount, () => { throw failure; })).toThrow(failure);
        expect(store.subscriberCount()).toBe(0);
    });

    test('a later run that throws is isolated and the next change runs again', () => {
        const store = new Counter({count: 0, label: 'a'});
        const seen: number[] = [];
        const original = console.error;
        console.error = (): void => undefined;
        try {
            const stop = storeEffect(store, selectCount, (count) => {
                seen.push(count);
                if (count === 1) throw new Error('one');
            });

            store.set(1);
            store.set(2);
            stop();
        } finally {
            console.error = original;
        }

        expect(seen).toEqual([0, 1, 2]);
        expect(store.subscriberCount()).toBe(0);
    });

    test('a cleanup that throws still lets the next run happen, and its error is reported', () => {
        const store = new Counter({count: 0, label: 'a'});
        const seen: number[] = [];
        const reported: unknown[] = [];
        const original = console.error;
        console.error = (): void => undefined;
        diagnostics.setFailureHandler((error) => { reported.push(error); });
        try {
            const stop = storeEffect(store, selectCount, (count) => {
                seen.push(count);
                return (): void => {
                    if (count === 0) throw new Error('cleanup of 0');
                };
            });

            store.set(1);
            store.set(2);
            stop();
        } finally {
            console.error = original;
            diagnostics.setFailureHandler(undefined);
        }

        // The run for 1 happened although the cleanup of 0 threw before it.
        expect(seen).toEqual([0, 1, 2]);
        expect(reported.some((entry) => entry instanceof Error && entry.message === 'cleanup of 0')).toBe(true);
        expect(store.subscriberCount()).toBe(0);
    });

    test('when both the cleanup and the run throw, the cleanup error is the one reported', () => {
        const store = new Counter({count: 0, label: 'a'});
        const seen: number[] = [];
        const reported: unknown[] = [];
        const original = console.error;
        console.error = (): void => undefined;
        diagnostics.setFailureHandler((error) => { reported.push(error); });
        try {
            const stop = storeEffect(store, selectCount, (count) => {
                seen.push(count);
                if (count === 1) throw new Error('run of 1');
                return (): void => {
                    if (count === 0) throw new Error('cleanup of 0');
                };
            });

            store.set(1);
            store.set(2);
            stop();
        } finally {
            console.error = original;
            diagnostics.setFailureHandler(undefined);
        }

        const messages = reported.map((entry) => (entry instanceof Error ? entry.message : String(entry)));
        expect(seen).toEqual([0, 1, 2]);
        expect(messages).toContain('cleanup of 0');
        expect(messages).not.toContain('run of 1');
        expect(store.subscriberCount()).toBe(0);
    });

    test('is the same function in the engine entry', () => {
        expect(Engine.storeEffect).toBe(storeEffect);
    });
});
