import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, computed} from '@/Carburetor';
import {CounterCarburetor, delta} from './fixtures';

describe('computed', () => {
    describe('publication freshness', () => {
        test('a mid-wave read cannot consume the first notification an observer is owed', () => {
            const carburetor = new CounterCarburetor({n: 1});
            let runs = 0;

            const doubled = computed<number>((read) => {
                runs++;

                return read(carburetor).n * 2;
            });

            const seen: number[] = [];

            class Display extends AntiHookComponent {
                render() {
                    return <div className="value">{this.useComputed(doubled)}</div>;
                }
            }

            const {container, unmount} = render(<Display />);
            expect(container.querySelector('.value')?.textContent).toEqual('2');

            doubled.subscribe(() => seen.push(doubled.get()), {id: 'observer'});

            // A raw store subscriber registered after the observer: its callback reads the
            // computed mid-wave, between invalidation and settlement. That read refreshes
            // the cache, but the observer still has only ever seen 2 — the change to 4 is
            // owed to them.
            carburetor.watch(new Set<string>(['n']), () => {
                doubled.get();
            });

            act(() => carburetor.setN(2));

            expect(carburetor.getData().n).toEqual(2);
            expect(doubled.get()).toEqual(4);
            // One eval for the initial mount, one for the mid-wave pull; the queued
            // settlement finds itself already fresh against that same pull and does not
            // rerun the body.
            expect(runs).toEqual(2);
            // The first real change was delivered to the observer and reached the DOM.
            expect(seen).toEqual([4]);
            expect(container.querySelector('.value')?.textContent).toEqual('4');

            unmount();
        });

        test('a resubscribed observer is told when the value moves away from what they saw', () => {
            const carburetor = new CounterCarburetor({n: 1});
            const doubled = computed<number>((read) => read(carburetor).n * 2);

            let notified = 0;
            const id = doubled.subscribe(() => notified++, {id: 'listener'});

            expect(doubled.get()).toEqual(2);

            doubled.unsubscribe(id);

            // Missed while unobserved, then read directly: an observer arriving now sees
            // 4, and this value — not the long-gone 2 — is the baseline they are owed.
            carburetor.setN(2);
            expect(doubled.get()).toEqual(4);

            doubled.subscribe(() => notified++, {id: 'listener'});
            expect(notified).toEqual(0);

            carburetor.setN(3);

            expect(doubled.get()).toEqual(6);
            expect(notified).toEqual(1);
        });

        test('an unequal-depth chain publishes only the settled result', () => {
            const carburetor = new CounterCarburetor({n: 1});

            const a = computed<number>((read) => read(carburetor).n * 2);
            const b = computed<number>((read) => read(a) + 1);
            // The body reads the raw store before the derived input, so total holds a
            // direct store subscription and can be woken before a and b have been told
            // about the write.
            const total = computed<number>((read) => read(carburetor).n + read(b));

            const delivered: number[] = [];
            total.subscribe(() => delivered.push(total.get()), {id: 'listener'});

            expect(total.get()).toEqual(4);

            carburetor.setN(2);

            // 5 would be a mixed-generation value: the new n combined with the old b.
            expect(delivered).toEqual([7]);
            expect(total.get()).toEqual(7);
        });

        test('R3-09: a direct-plus-derived diamond evaluates each node once per write', () => {
            const carburetor = new CounterCarburetor({n: 1});
            const calls = [0, 0, 0];

            const a = computed<number>((read) => {
                calls[0]++;

                return read(carburetor).n * 2;
            });
            const b = computed<number>((read) => {
                calls[1]++;

                return read(a) + 1;
            });
            // total reaches n both directly and through a -> b, so the write reaches it
            // once directly and once by cascading through the derived chain.
            const total = computed<number>((read) => {
                calls[2]++;

                return read(carburetor).n + read(b);
            });

            const delivered: number[] = [];
            total.subscribe(() => delivered.push(total.get()), {id: 'listener'});

            expect(total.get()).toEqual(4);
            expect(calls).toEqual([1, 1, 1]);

            const afterSubscribe = [...calls];

            carburetor.setN(2);

            // Each node's body runs exactly once for the write: a settlement that finds
            // its value already fresh — recomputed earlier in the same wave by another
            // node's eager pull — does not rerun the body a second time.
            expect(delta(afterSubscribe, calls)).toEqual([1, 1, 1]);
            expect(delivered).toEqual([7]);
            expect(total.get()).toEqual(7);
        });

        test('an unequal-depth diamond publishes only the settled result', () => {
            const carburetor = new CounterCarburetor({n: 1});

            const deep = computed<number>((read) => read(carburetor).n * 2);
            const mid = computed<number>((read) => read(deep) + 1);
            const shallow = computed<number>((read) => read(carburetor).n * 10);
            // A direct store input beside a two-step derived input.
            const total = computed<number>((read) => read(carburetor).n + read(mid) + read(shallow));

            const delivered: number[] = [];
            total.subscribe(() => delivered.push(total.get()), {id: 'listener'});

            expect(total.get()).toEqual(14);

            carburetor.setN(2);

            expect(delivered).toEqual([27]);
            expect(total.get()).toEqual(27);
        });

        test('the graph settles coherently whatever order the subscriptions were made in', () => {
            const carburetor = new CounterCarburetor({n: 1});

            const a = computed<number>((read) => read(carburetor).n * 2);
            const b = computed<number>((read) => read(a) + 1);
            const total = computed<number>((read) => read(carburetor).n + read(b));

            // The derived middle is observed before the top: its store subscription is
            // registered first, reversing the order the write is delivered in.
            let innerNotified = 0;
            b.subscribe(() => innerNotified++, {id: 'b-listener'});

            const delivered: number[] = [];
            total.subscribe(() => delivered.push(total.get()), {id: 'total-listener'});

            expect(total.get()).toEqual(4);

            carburetor.setN(2);

            expect(delivered).toEqual([7]);
            expect(b.get()).toEqual(5);
            expect(innerNotified).toEqual(1);
            expect(total.get()).toEqual(7);
        });

        test('an upstream failure stops an observed computed from serving a stale value', () => {
            const carburetor = new CounterCarburetor({n: 1});
            let poison = false;

            const inner = computed<number>((read) => {
                if (poison) {
                    throw new Error('inner failed');
                }

                return read(carburetor).n + 1;
            });

            const outer = computed<number>((read) => read(inner) * 10);

            let notified = 0;
            outer.subscribe(() => notified++, {id: 'listener'});

            expect(outer.get()).toEqual(20);

            poison = true;

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                carburetor.setN(2);
            } finally {
                console.error = original;
            }

            expect(reported.length).toEqual(1);
            expect(notified).toEqual(0);
            expect(() => inner.get()).toThrow('inner failed');
            // The outer computed must not claim its cached 20 as if it were still current:
            // the dependency it was built from can no longer produce a value.
            expect(() => outer.get()).toThrow('inner failed');

            poison = false;

            carburetor.setN(3);

            expect(outer.get()).toEqual(40);
            expect(notified).toEqual(1);
        });
    });

});
