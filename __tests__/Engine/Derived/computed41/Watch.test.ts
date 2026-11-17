import {Carburetor, computed, diagnostics, transaction} from '@/Carburetor';

interface ICounter {count: number; label: string}

const setCount = (draft: ICounter, count: number): void => { draft.count = count; };
const setLabel = (draft: ICounter, label: string): void => { draft.label = label; };

class Counter extends Carburetor<ICounter> {
    public set(count: number): void { this.update(setCount, count); }
    public rename(label: string): void { this.update(setLabel, label); }
}

describe('computed.watch', () => {
    test('hands the new and the previous value to the callback on each change, until disposed', () => {
        const counter = new Counter({count: 1, label: 'a'});
        const doubled = computed(read => read(counter).count * 2);
        const seen: Array<[number, number]> = [];
        const stop = doubled.watch((next, previous) => { seen.push([next, previous]); });

        counter.set(2);
        counter.set(5);
        stop();
        counter.set(9);

        expect(seen).toEqual([[4, 2], [10, 4]]);
    });

    test('a write the value does not depend on, or one that leaves it equal, calls nothing', () => {
        const counter = new Counter({count: 1, label: 'a'});
        const parity = computed(read => read(counter).count % 2);
        const seen: number[] = [];
        const stop = parity.watch((next) => { seen.push(next); });

        counter.rename('b');
        counter.set(3);
        counter.set(4);

        expect(seen).toEqual([0]);
        stop();
    });

    test('equals decides what counts as a change, as it does for every subscriber', () => {
        const counter = new Counter({count: 1, label: 'a'});
        const pair = computed(read => ({even: read(counter).count % 2 === 0}), {
            equals: (left, right) => left.even === right.even,
        });
        const seen: boolean[] = [];
        const stop = pair.watch((next) => { seen.push(next.even); });

        counter.set(3);
        counter.set(6);

        expect(seen).toEqual([true]);
        stop();
    });

    test('the disposer can run twice, and two watchers stop independently', () => {
        const counter = new Counter({count: 0, label: 'a'});
        const value = computed(read => read(counter).count);
        const first: number[] = [];
        const second: number[] = [];
        const stopFirst = value.watch((next) => { first.push(next); });
        const stopSecond = value.watch((next) => { second.push(next); });

        counter.set(1);
        stopFirst();
        stopFirst();
        counter.set(2);
        stopSecond();
        counter.set(3);

        expect(first).toEqual([1]);
        expect(second).toEqual([1, 2]);
    });

    test('a body that throws reaches the failure handler and onChange does not run', () => {
        const counter = new Counter({count: 0, label: 'a'});
        const value = computed(read => {
            const {count} = read(counter);
            if (count === 1) throw new Error('odd');
            return count;
        });
        const seen: number[] = [];
        const failures: string[] = [];
        diagnostics.setFailureHandler((_error, source) => { failures.push(source); });
        const original = console.error;
        console.error = (): void => undefined;
        try {
            const stop = value.watch((next) => { seen.push(next); });

            counter.set(1);
            counter.set(2);
            stop();
        } finally {
            console.error = original;
            diagnostics.setFailureHandler(undefined);
        }

        expect(seen).toEqual([2]);
        expect(failures.length).toBeGreaterThan(0);
    });

    test('a transaction delivers one change for several writes', () => {
        const counter = new Counter({count: 0, label: 'a'});
        const value = computed(read => read(counter).count);
        const seen: Array<[number, number]> = [];
        const stop = value.watch((next, previous) => { seen.push([next, previous]); });

        transaction(() => {
            counter.set(1);
            counter.set(2);
            counter.set(3);
        });
        stop();

        expect(seen).toEqual([[3, 0]]);
    });

    test('a watcher that disposes itself in onChange is not called again', () => {
        const counter = new Counter({count: 0, label: 'a'});
        const value = computed(read => read(counter).count);
        const seen: number[] = [];
        const stop = value.watch((next) => {
            seen.push(next);
            stop();
        });

        counter.set(1);
        counter.set(2);

        expect(seen).toEqual([1]);
    });

    test('a watcher stopped inside a transaction is not called when it closes', () => {
        const counter = new Counter({count: 0, label: 'a'});
        const value = computed(read => read(counter).count);
        const seen: number[] = [];
        const stop = value.watch((next) => { seen.push(next); });

        transaction(() => {
            counter.set(1);
            stop();
        });

        expect(seen).toEqual([]);
    });

    test('a watcher stopped by another during the same delivery is not called', () => {
        const counter = new Counter({count: 0, label: 'a'});
        const value = computed(read => read(counter).count);
        const seen: string[] = [];
        let stopSecond: () => void = () => undefined;
        const stopFirst = value.watch((next) => {
            seen.push(`first ${next}`);
            stopSecond();
        });
        stopSecond = value.watch((next) => { seen.push(`second ${next}`); });

        counter.set(1);
        counter.set(2);
        stopFirst();

        expect(seen).toEqual(['first 1', 'first 2']);
    });
});
