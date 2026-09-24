import {computed, transaction} from '@/Carburetor';
import {ListCarburetor, delta, getData} from './fixtures';

describe('computed', () => {
    describe('dependency maintenance', () => {
        test('one source change evaluates each node of a four-node chain once', () => {
            const carburetor = new ListCarburetor(getData());
            const calls: number[] = [0, 0, 0, 0];

            const first = computed<number>((read) => {
                calls[0]++;

                return read(carburetor).items.a.done ? 1 : 0;
            });

            const second = computed<number>((read) => {
                calls[1]++;

                return read(first) + 1;
            });

            const third = computed<number>((read) => {
                calls[2]++;

                return read(second) + 1;
            });

            const fourth = computed<number>((read) => {
                calls[3]++;

                return read(third) + 1;
            });

            // Only the top of the chain is observed, so the whole graph is retained by
            // one subscription and the write must travel source to sink exactly once.
            fourth.subscribe(() => undefined, {id: 'listener'});

            expect(calls).toEqual([1, 1, 1, 1]);

            const afterSubscribe = [...calls];

            carburetor.setDone('a', true);

            const delta = calls.map((count: number, index: number): number => count - afterSubscribe[index]);

            expect(delta).toEqual([1, 1, 1, 1]);
        });

        test('a diamond announces the settled result once, with each node evaluated once', () => {
            const carburetor = new ListCarburetor(getData());
            const calls: number[] = [0, 0, 0];
            let announced = 0;

            const left = computed<number>((read) => {
                calls[0]++;

                return read(carburetor).items.a.done ? 1 : 0;
            });

            const right = computed<number>((read) => {
                calls[1]++;

                return read(carburetor).items.a.done ? 10 : 0;
            });

            const total = computed<number>((read) => {
                calls[2]++;

                return read(left) + read(right);
            });

            total.subscribe(() => announced++, {id: 'listener'});

            expect(calls).toEqual([1, 1, 1]);
            expect(announced).toEqual(0);

            const afterSubscribe = [...calls];

            carburetor.setDone('a', true);

            expect(delta(afterSubscribe, calls)).toEqual([1, 1, 1]);
            expect(announced).toEqual(1);
            expect(total.get()).toEqual(11);
        });

        test('an inner change that does not move the derived value leaves the chain above quiet', () => {
            const carburetor = new ListCarburetor(getData());
            const calls: number[] = [0, 0, 0];
            let notified = 0;

            const inner = computed<number>((read) => {
                calls[0]++;

                return read(carburetor).items.a.done ? 2 : 1;
            });

            const mid = computed<string>((read) => {
                calls[1]++;

                return 'same ' + (read(inner) > 0);
            });

            const top = computed<string>((read) => {
                calls[2]++;

                return read(mid) + '!';
            });

            top.subscribe(() => notified++, {id: 'listener'});

            const afterSubscribe = [...calls];

            carburetor.setDone('a', true);

            // inner moved (1 -> 2) and mid rechecked its output, but the output stayed
            // equal, so top was never asked to recompute and nobody was woken.
            expect(delta(afterSubscribe, calls)).toEqual([1, 1, 0]);
            expect(notified).toEqual(0);
            expect(top.get()).toEqual('same true!');
        });

        test('a conditional body detaches the abandoned branch and attaches the adopted one', () => {
            const carburetor = new ListCarburetor(getData());
            let runs = 0;

            const label = computed<string>((read) => {
                runs++;

                const data = read(carburetor);

                return data.items.a.done ? data.items.a.title : data.items.b.title;
            });

            label.subscribe(() => undefined, {id: 'listener'});

            expect(label.get()).toEqual('b');
            expect(runs).toEqual(1);

            carburetor.setDone('a', true);

            expect(label.get()).toEqual('a');
            expect(runs).toEqual(2);

            // The body no longer reads b's title: writing it must reach nobody.
            carburetor.setTitle('b', 'changed');
            expect(runs).toEqual(2);
            expect(label.get()).toEqual('a');

            // The adopted branch is live.
            carburetor.setTitle('a', 'renamed');
            expect(label.get()).toEqual('renamed');
            expect(runs).toEqual(3);
        });

        test('removing the last observer releases the graph, and unobserved reads stay fresh', () => {
            const carburetor = new ListCarburetor(getData());
            const calls: number[] = [0, 0, 0, 0];

            const first = computed<number>((read) => {
                calls[0]++;

                return read(carburetor).items.a.done ? 1 : 0;
            });

            const second = computed<number>((read) => {
                calls[1]++;

                return read(first) + 1;
            });

            const third = computed<number>((read) => {
                calls[2]++;

                return read(second) + 1;
            });

            const fourth = computed<number>((read) => {
                calls[3]++;

                return read(third) + 1;
            });

            fourth.subscribe(() => undefined, {id: 'listener'});

            expect(calls).toEqual([1, 1, 1, 1]);

            fourth.unsubscribe('listener');

            // The released graph misses the write entirely: no body runs.
            carburetor.setDone('a', true);
            expect(calls).toEqual([1, 1, 1, 1]);

            // An unobserved read rechecks its inputs instead of trusting the stale cache.
            expect(fourth.get()).toEqual(4);
            expect(calls).toEqual([2, 2, 2, 2]);
        });

        test('a transaction writing two stores settles a chain built on both once', () => {
            const first = new ListCarburetor(getData());
            const second = new ListCarburetor(getData());
            const calls: number[] = [0, 0, 0];
            let notified = 0;

            const firstDone = computed<number>((read) => {
                calls[0]++;

                return read(first).items.a.done ? 1 : 0;
            });

            const secondDone = computed<number>((read) => {
                calls[1]++;

                return read(second).items.b.done ? 10 : 0;
            });

            const total = computed<number>((read) => {
                calls[2]++;

                return read(firstDone) + read(secondDone);
            });

            total.subscribe(() => notified++, {id: 'listener'});

            expect(total.get()).toEqual(10);

            const afterSubscribe = [...calls];

            transaction(() => {
                first.setDone('a', true);
                second.setDone('b', false);
            });

            expect(delta(afterSubscribe, calls)).toEqual([1, 1, 1]);
            expect(total.get()).toEqual(1);
            expect(notified).toEqual(1);
        });

        test('a read taken during a wave sees settled values, not a half-applied write', () => {
            const carburetor = new ListCarburetor(getData());
            const calls: number[] = [0, 0, 0];
            let seenMidWave: number | undefined = undefined;
            let innerNotifications = 0;

            const inner = computed<number>((read) => {
                calls[0]++;

                return read(carburetor).items.a.done ? 1 : 0;
            });

            const other = computed<number>((read) => {
                calls[1]++;

                return read(carburetor).items.a.done ? 10 : 0;
            });

            const total = computed<number>((read) => {
                calls[2]++;

                return read(inner) + read(other);
            });

            total.subscribe(() => undefined, {id: 'total-observer'});
            inner.subscribe(() => {
                innerNotifications++;

                // inner settles first in the wave; total is still queued, so this read
                // happens mid-wave and must still see the settled combination.
                seenMidWave = total.get();
            }, {id: 'inner-observer'});

            const afterSubscribe = [...calls];

            carburetor.setDone('a', true);

            // The mid-wave read of total recomputes other and total eagerly while their
            // settlements are still queued; each queued settlement then finds itself
            // already fresh against the same upstream state and does not rerun the body —
            // what this pins is that the read saw settled values at no extra cost.
            expect(delta(afterSubscribe, calls)).toEqual([1, 1, 1]);
            expect(seenMidWave).toEqual(11);
            expect(total.get()).toEqual(11);
            expect(innerNotifications).toEqual(1);
        });
    });

});
