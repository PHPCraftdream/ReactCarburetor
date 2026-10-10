import {C} from '@/Carburetor/Derived/Models';
import {computed, transaction} from '@/Carburetor';
import {sharedSingleton} from '@/Carburetor/Store/Utils/sharedSingleton';
import {CounterCarburetor, ExternalComputed, ListCarburetor, delta, getData} from './fixtures';

describe('computed', () => {
    describe('dependency maintenance', () => {
        test.each(['external', '__proto__', 'constructor', 'toString', ':__proto__', ':constructor'])(
            'external interface source %s stays fresh without observation', (uid) => {
                const source = new ExternalComputed(7, uid);
                Object.assign(source, {versions: undefined});
                const inner = computed(read => read(source) * 2);
                const outer = computed(read => read(inner) + 1);
                expect(outer.get()).toEqual(15);
                expect(source.listeners.size).toEqual(0);
                source.set(8);
                expect(outer.get()).toEqual(17);
                expect(source.listeners.size).toEqual(0);
            },
        );

        test.each(['__proto__', 'constructor', 'toString', ':__proto__'])(
            'observed external id %s retains its edge and releases it', (uid) => {
                const source = new ExternalComputed(1, uid);
                const value = computed(read => read(source) * 2);
                const seen: number[] = [];
                const id = value.subscribe(() => seen.push(value.get()));
                source.set(2);
                source.set(3);
                expect(seen).toEqual([4, 6]);
                expect(source.listeners.size).toEqual(1);
                value.unsubscribe(id);
                expect(source.listeners.size).toEqual(0);
            },
        );

        test('unchanged native read sets keep their upstream registrations', () => {
            const store = new CounterCarburetor({n: 0});
            const storeSubscribe = rstest.spyOn(store, 'subscribe');
            const storeUnsubscribe = rstest.spyOn(store, 'unsubscribe');
            const inner = computed(read => read(store).n);
            const innerSubscribe = rstest.spyOn(inner, 'subscribe');
            const innerUnsubscribe = rstest.spyOn(inner, 'unsubscribe');
            const outer = computed(read => read(inner) * 2);
            const id = outer.subscribe(() => undefined);
            store.setN(1);
            store.setN(2);
            expect(outer.get()).toEqual(4);
            expect(storeSubscribe).toHaveBeenCalledTimes(1);
            expect(innerSubscribe).toHaveBeenCalledTimes(1);
            expect(storeUnsubscribe).not.toHaveBeenCalled();
            expect(innerUnsubscribe).not.toHaveBeenCalled();
            outer.unsubscribe(id);
            expect(storeUnsubscribe).toHaveBeenCalledTimes(1);
            expect(innerUnsubscribe).toHaveBeenCalledTimes(1);
        });

        test('an observed body that stops reading sources releases its last edge', () => {
            const source = new ExternalComputed(1, '__proto__');
            let detached = false;
            const value = computed(read => detached ? 7 : read(source));
            const seen: number[] = [];
            const id = value.subscribe(() => seen.push(value.get()));
            detached = true;
            source.set(2);
            expect(seen).toEqual([7]);
            expect(source.listeners.size).toEqual(0);
            source.set(3);
            expect(value.get()).toEqual(7);
            expect(seen).toEqual([7]);
            value.unsubscribe(id);
        });

        test('an observed external source publishes and releases its shared upstream edge', () => {
            const source = new ExternalComputed();
            const value = computed(read => read(source) * 2);
            const seen: number[] = [];
            const id = value.subscribe(() => seen.push(value.get()));
            expect(source.listeners.size).toEqual(1);
            source.set(8);
            expect(seen).toEqual([16]);
            expect(value.getVersion()).toEqual(1);
            value.unsubscribe(id);
            expect(source.listeners.size).toEqual(0);
            source.set(9);
            expect(seen).toEqual([16]);
            expect(value.get()).toEqual(18);
        });

        test('an external diamond evaluates each node once and publishes one settled total', () => {
            const source = new ExternalComputed(0);
            const runs = [0, 0, 0];
            const left = computed(read => { runs[0]++; return read(source) + 1; });
            const right = computed(read => { runs[1]++; return read(source) * 10; });
            const total = computed(read => { runs[2]++; return read(left) + read(right); });
            const seen: number[] = [];
            const id = total.subscribe(() => seen.push(total.get()));
            expect(source.listeners.size).toEqual(1);
            runs.fill(0);
            source.set(1);
            expect(runs).toEqual([1, 1, 1]);
            expect(seen).toEqual([12]);
            total.unsubscribe(id);
            expect(source.listeners.size).toEqual(0);
        });

        test('one external dependent can detach while the remaining bridge stays live', () => {
            const source = new ExternalComputed(1);
            const first = computed(read => read(source) * 2);
            const second = computed(read => read(source) * 3);
            const seen: number[] = [];
            const firstId = first.subscribe(() => { throw new Error('detached observer'); });
            const secondId = second.subscribe(() => seen.push(second.get()));
            expect(source.listeners.size).toEqual(1);
            first.unsubscribe(firstId);
            source.set(2);
            expect(seen).toEqual([6]);
            expect(source.listeners.size).toEqual(1);
            second.unsubscribe(secondId);
            expect(source.listeners.size).toEqual(0);
        });

        test('conditional external dependencies detach the abandoned source', () => {
            const selector = new CounterCarburetor({n: 0});
            const first = new ExternalComputed(1, '__proto__');
            const second = new ExternalComputed(2, 'constructor');
            const value = computed(read => read(read(selector).n ? second : first));
            const seen: number[] = [];
            const id = value.subscribe(() => seen.push(value.get()));
            selector.setN(1);
            expect(first.listeners.size).toEqual(0);
            expect(second.listeners.size).toEqual(1);
            first.set(3);
            second.set(4);
            expect(seen).toEqual([2, 4]);
            value.unsubscribe(id);
            expect(second.listeners.size).toEqual(0);
        });

        test('a foreign native metadata getter flattens versions without an instanceof check', () => {
            const store = new CounterCarburetor({n: 1});
            const source = new ExternalComputed(2);
            const metadata = sharedSingleton('computedVersions', () =>
                new WeakMap<object, () => Record<string, {source: CounterCarburetor; version: number}>>());
            metadata.set(source, () => ({[store.getUID()]: {source: store, version: store.getVersion()}}));
            source.get = () => store.getData().n * 2;
            const outer = computed(read => read(source) + 1);
            expect(outer.get()).toEqual(3);
            store.setN(2);
            expect(source.getVersion()).toEqual(0);
            expect(outer.get()).toEqual(5);
            metadata.delete(source);
        });

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

        test('a 26-node ladder marks each node a bounded number of times per write, and every body runs once', () => {
            const carburetor = new CounterCarburetor({n: 0});
            const NODES = 26;
            const nodes: ReturnType<typeof computed<number>>[] = [];
            const bodyRuns = Array.from({length: NODES}, () => 0);

            nodes.push(computed<number>((read) => {
                bodyRuns[0]++;

                return read(carburetor).n;
            }));
            nodes.push(computed<number>((read) => {
                bodyRuns[1]++;

                return read(carburetor).n + 1;
            }));

            for (let i = 2; i < NODES; i++) {
                const a = nodes[i - 1];
                const b = nodes[i - 2];

                nodes.push(computed<number>((read) => {
                    bodyRuns[i]++;

                    return read(a) + read(b);
                }));
            }

            // The same map Computed.ts files every computed's invalidation callback under (see
            // its docstring): wrapping each node's entry counts every markStale call this write
            // reaches, recursive ones included — the methodology R16-06's evidence table used.
            const invalidationEdges = sharedSingleton('invalidationEdges', () => new WeakMap<() => void, () => void>());
            let markStaleCalls = 0;

            nodes.forEach((node) => {
                const key = (node as unknown as {[C.onDependencyChanged]: () => void})[C.onDependencyChanged];
                const original = invalidationEdges.get(key);

                if (original) {
                    invalidationEdges.set(key, () => {
                        markStaleCalls++;
                        original();
                    });
                }
            });

            nodes[NODES - 1].subscribe(() => undefined, {id: 'listener'});
            bodyRuns.fill(0);

            carburetor.setN(1);

            // Every node past the base two reads exactly two upstream computeds, so observing
            // the whole chain gives each of them exactly two incoming edges: linear in the node
            // count. Pre-fix, the same write drives roughly a million calls on this ladder
            // (Fibonacci growth, confirmed by running this assertion against the pre-fix
            // Computed.ts) because a call that finds its target already marked re-walks the
            // whole graph below it again instead of returning.
            expect(markStaleCalls).toEqual(2 * (NODES - 2));
            expect(bodyRuns).toEqual(Array.from({length: NODES}, () => 1));
        });
    });

});
