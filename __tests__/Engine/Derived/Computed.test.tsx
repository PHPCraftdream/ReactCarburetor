import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, computed, diagnostics, transaction} from "@/Carburetor";

interface ITodoLike {
    items: {
        [id: string]: {
            title: string;
            done: boolean;
        };
    };
}

const getData = (): ITodoLike => ({
    items: {
        a: {title: 'a', done: false},
        b: {title: 'b', done: true},
    },
});

class ListCarburetor extends Carburetor<ITodoLike> {
    public setTitle = (id: string, title: string) => {
        this.draft.items[id].title = title;

        this.emitUpdate();
    };

    public setDone = (id: string, done: boolean) => {
        this.draft.items[id].done = done;

        this.emitUpdate();
    };
}

class CounterCarburetor extends Carburetor<{n: number}> {
    public setN = (n: number) => {
        this.draft.n = n;

        this.emitUpdate();
    };
}

interface IIndexedData {
    index: Map<string, number>;
}

const getIndexData = (): IIndexedData => ({index: new Map([['a', 1]])});

class IndexedCarburetor extends Carburetor<IIndexedData> {
    public setIndex = (key: string, value: number) => {
        this.draft.index.set(key, value);

        this.emitUpdate();
    };
}

const delta = (before: number[], after: number[]): number[] =>
    after.map((count: number, index: number): number => count - before[index]);

describe('computed', () => {
    test('computes lazily and memoizes the result', () => {
        const carburetor = new ListCarburetor(getData());
        let runs = 0;

        const doneCount = computed<number>((read) => {
            runs++;
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        expect(runs).toEqual(0);

        expect(doneCount.get()).toEqual(1);
        expect(runs).toEqual(1);

        expect(doneCount.get()).toEqual(1);
        expect(runs).toEqual(1);
    });

    test('recomputes only when a dependency path is written', () => {
        const carburetor = new ListCarburetor(getData());
        let runs = 0;

        const doneCount = computed<number>((read) => {
            runs++;
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        doneCount.subscribe(() => undefined, {id: 'listener'});
        expect(runs).toEqual(1);

        carburetor.setDone('a', true);
        expect(runs).toEqual(2);
        expect(doneCount.get()).toEqual(2);
    });

    test('does not wake subscribers when the derived value stays the same', () => {
        const carburetor = new ListCarburetor(getData());
        let notified = 0;

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        doneCount.subscribe(() => notified++, {id: 'listener'});

        carburetor.setTitle('a', 'renamed');
        expect(notified).toEqual(0);

        carburetor.setDone('a', true);
        expect(notified).toEqual(1);
    });

    test('drops dependencies when the last subscriber leaves', () => {
        const carburetor = new ListCarburetor(getData());
        let runs = 0;

        const doneCount = computed<number>((read) => {
            runs++;
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        doneCount.subscribe(() => undefined, {id: 'listener'});
        expect(runs).toEqual(1);

        doneCount.unsubscribe('listener');

        carburetor.setDone('a', true);
        expect(runs).toEqual(1);
    });

    test('recomputes once per transaction', () => {
        const carburetor = new ListCarburetor(getData());
        let runs = 0;

        const doneCount = computed<number>((read) => {
            runs++;
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        doneCount.subscribe(() => undefined, {id: 'listener'});
        expect(runs).toEqual(1);

        transaction(() => {
            carburetor.setDone('a', true);
            carburetor.setTitle('a', 'x');
            carburetor.setTitle('b', 'y');
        });

        expect(runs).toEqual(2);
    });

    test('a computed reading another computed tracks it as a dependency', () => {
        const carburetor = new ListCarburetor(getData());

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        const label = computed<string>((read) => 'done: ' + read(doneCount));

        let notified = 0;
        label.subscribe(() => notified++, {id: 'listener'});

        expect(label.get()).toEqual('done: 1');

        carburetor.setDone('a', true);

        expect(label.get()).toEqual('done: 2');
        expect(notified).toEqual(1);
    });

    test('a chain of computeds stays quiet when the inner value does not move', () => {
        const carburetor = new ListCarburetor(getData());
        let innerRuns = 0;
        let outerRuns = 0;

        const doneCount = computed<number>((read) => {
            innerRuns++;
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        const label = computed<string>((read) => {
            outerRuns++;

            return 'done: ' + read(doneCount);
        });

        let notified = 0;
        label.subscribe(() => notified++, {id: 'listener'});

        expect(innerRuns).toEqual(1);
        expect(outerRuns).toEqual(1);

        // A title change invalidates the inner computed but does not move its value,
        // so the outer one is never asked to recompute.
        carburetor.setTitle('a', 'renamed');

        expect(innerRuns).toEqual(2);
        expect(outerRuns).toEqual(1);
        expect(notified).toEqual(0);

        carburetor.setDone('a', true);

        expect(outerRuns).toEqual(2);
        expect(notified).toEqual(1);
    });

    test('dropping the outer computed releases the whole chain', () => {
        const carburetor = new ListCarburetor(getData());
        let innerRuns = 0;

        const doneCount = computed<number>((read) => {
            innerRuns++;
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        const label = computed<string>((read) => 'done: ' + read(doneCount));

        label.subscribe(() => undefined, {id: 'listener'});
        expect(innerRuns).toEqual(1);

        label.unsubscribe('listener');

        carburetor.setDone('a', true);

        expect(innerRuns).toEqual(1);
    });

    test('component reading a computed re-renders only when it changes', () => {
        const carburetor = new ListCarburetor(getData());
        let renders = 0;

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        class Counter extends AntiHookComponent {
            render() {
                renders++;

                return <div className="count">{this.useComputed(doneCount)}</div>;
            }
        }

        const {container, unmount} = render(<Counter />);
        expect(container.querySelector('.count')?.textContent).toEqual('1');
        expect(renders).toEqual(1);

        // A title change does not move the counter, so the component stays put.
        act(() => carburetor.setTitle('a', 'renamed'));
        expect(renders).toEqual(1);

        act(() => carburetor.setDone('a', true));
        expect(renders).toEqual(2);
        expect(container.querySelector('.count')?.textContent).toEqual('2');

        unmount();
    });

    test('a value computed while unobserved is rechecked when someone subscribes', () => {
        const carburetor = new ListCarburetor(getData());
        let runs = 0;

        const doneCount = computed<number>((read) => {
            runs++;
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        expect(doneCount.get()).toEqual(1);
        expect(runs).toEqual(1);

        // Nobody is subscribed, so this write reaches no one.
        carburetor.setDone('a', true);

        let notified = 0;
        doneCount.subscribe(() => notified++, {id: 'listener'});

        expect(notified).toEqual(0);
        expect(doneCount.get()).toEqual(2);
        expect(runs).toEqual(2);
    });

    test('a component mounting after an unobserved write sees the written value', () => {
        const carburetor = new ListCarburetor(getData());
        let renders = 0;

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        expect(doneCount.get()).toEqual(1);

        carburetor.setDone('a', true);

        class Counter extends AntiHookComponent {
            render() {
                renders++;

                return <div className="count">{this.useComputed(doneCount)}</div>;
            }
        }

        const {container, unmount} = render(<Counter />);
        expect(container.querySelector('.count')?.textContent).toEqual('2');
        expect(renders).toEqual(1);

        unmount();
    });

    test('a diamond computed never delivers a value its inputs disagree on', () => {
        const carburetor = new ListCarburetor(getData());

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        const aDone = computed<boolean>((read) => read(carburetor).items.a.done);

        const total = computed<number>((read) => read(doneCount) * 10 + (read(aDone) ? 1 : 0));

        const delivered: number[] = [];
        total.subscribe(() => delivered.push(total.get()), {id: 'listener'});

        expect(total.get()).toEqual(10);
        expect(delivered).toEqual([]);

        // One write moves both doneCount and aDone; total must settle once, after both.
        carburetor.setDone('a', true);

        expect(delivered).toEqual([21]);
        expect(total.get()).toEqual(21);
    });

    test('a transaction writing two stores settles a computed reading both once', () => {
        const first = new ListCarburetor(getData());
        const second = new ListCarburetor(getData());
        let runs = 0;
        let notified = 0;

        const total = computed<number>((read) => {
            runs++;

            return (read(first).items.a.done ? 1 : 0) + (read(second).items.b.done ? 10 : 0);
        });

        total.subscribe(() => notified++, {id: 'listener'});

        expect(total.get()).toEqual(10);
        expect(runs).toEqual(1);

        transaction(() => {
            first.setDone('a', true);
            second.setDone('b', false);
        });

        expect(total.get()).toEqual(1);
        expect(runs).toEqual(2);
        expect(notified).toEqual(1);
    });

    describe('error isolation', () => {
        test('a throwing subscriber does not skip a later subscriber of the same computed', () => {
            const carburetor = new ListCarburetor(getData());
            let later = 0;

            const doneCount = computed<number>((read) => {
                const {items} = read(carburetor);

                return Object.keys(items).filter((id: string) => items[id].done).length;
            });

            doneCount.subscribe(() => {
                throw new Error('subscriber failed');
            }, {id: 'boom'});
            doneCount.subscribe(() => later++, {id: 'later'});

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            expect(later).toEqual(1);

            // The throw is reported through diagnostics, not re-thrown into whoever wrote.
            expect(reported.length).toEqual(1);
            expect(reported[0]).toContain('subscriber threw');
        });

        test('a throwing subscriber does not prevent an independent computed from being delivered', () => {
            const carburetor = new ListCarburetor(getData());
            let healthyNotified = 0;

            const broken = computed<boolean>((read) => read(carburetor).items.a.done);
            const healthy = computed<boolean>((read) => read(carburetor).items.a.done);

            broken.subscribe(() => {
                throw new Error('observer failed');
            }, {id: 'boom'});

            healthy.subscribe(() => healthyNotified++, {id: 'healthy'});

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            expect(healthyNotified).toEqual(1);
            expect(reported.length).toEqual(1);
            expect(reported[0]).toContain('subscriber threw');
        });

        test('a failing body is not announced as a success and does not suppress an independent computed', () => {
            const carburetor = new ListCarburetor(getData());
            // Start b undone, so the retry write below actually moves the value.
            carburetor.setDone('b', false);
            let poison = false;
            let brokenNotified = 0;
            let healthyNotified = 0;

            const broken = computed<number>((read) => {
                const {items} = read(carburetor);

                if (poison) {
                    throw new Error('body failed');
                }

                return (items.a.done ? 1 : 0) + (items.b.done ? 2 : 0);
            });

            const healthy = computed<number>((read) => (read(carburetor).items.a.done ? 10 : 0));

            broken.subscribe(() => brokenNotified++, {id: 'broken'});
            healthy.subscribe(() => healthyNotified++, {id: 'healthy'});

            expect(broken.get()).toEqual(0);

            poison = true;

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            // The independent computed was delivered; the failed one stayed silent.
            expect(healthyNotified).toEqual(1);
            expect(brokenNotified).toEqual(0);
            expect(reported.length).toEqual(1);

            // The old value is not announced as a fresh success: the version stands still and
            // an explicit read exposes the failure to its reader.
            expect(broken.getVersion()).toEqual(0);
            expect(() => broken.get()).toThrow('body failed');

            // Clearing the cause and writing again retries the body; delivery resumes.
            poison = false;

            carburetor.setDone('b', true);

            expect(brokenNotified).toEqual(1);
            expect(broken.get()).toEqual(3);
        });

        test('work queued during delivery is completed even when another settlement fails', () => {
            const carburetor = new ListCarburetor(getData());
            // Start b undone, so the mid-delivery write actually moves the value.
            carburetor.setDone('b', false);
            let poison = false;
            let healthyNotified = 0;
            let cascades = 0;

            const broken = computed<number>((read) => {
                const {items} = read(carburetor);

                if (poison) {
                    throw new Error('body failed');
                }

                return items.a.done ? 1 : 0;
            });

            const healthy = computed<number>((read) => {
                const {items} = read(carburetor);

                return (items.a.done ? 1 : 0) + (items.b.done ? 2 : 0);
            });

            broken.subscribe(() => undefined, {id: 'broken'});

            healthy.subscribe(() => {
                healthyNotified++;

                // The first delivery writes again, so a fresh settlement queues mid-drain.
                if (cascades++ === 0) {
                    carburetor.setDone('b', true);
                }
            }, {id: 'healthy'});

            poison = true;

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                console.error = original;
            }

            // healthy settled once for the write, and once more for the write its own delivery
            // made — the failing computation did not strand that queued work.
            expect(healthyNotified).toEqual(2);
            expect(reported.length).toBeGreaterThan(0);
        });

        test('delivery stays isolated with diagnostics switched off', () => {
            const carburetor = new ListCarburetor(getData());
            let later = 0;

            const doneCount = computed<number>((read) => {
                const {items} = read(carburetor);

                return Object.keys(items).filter((id: string) => items[id].done).length;
            });

            doneCount.subscribe(() => {
                throw new Error('subscriber failed');
            }, {id: 'boom'});
            doneCount.subscribe(() => later++, {id: 'later'});

            const original = console.error;
            const reported: string[] = [];

            console.error = (message: string) => reported.push(message);
            diagnostics.setEnabled(false);

            try {
                expect(() => carburetor.setDone('a', true)).not.toThrow();
            } finally {
                diagnostics.setEnabled(true);
                console.error = original;
            }

            // Delivery behaves the same with diagnostics off: the later subscriber is still
            // woken, and nothing is reported.
            expect(later).toEqual(1);
            expect(reported).toEqual([]);
        });
    });

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

    describe('exotic results (R6-02)', () => {
        test('a coarse-path Map mutation notifies subscribers even though the result reference is unchanged', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            const index = computed<Map<string, number>>((read) => read(carburetor).index);

            index.subscribe(() => notified++, {id: 'listener'});

            expect(index.getVersion()).toEqual(0);

            carburetor.setIndex('a', 2);

            expect(notified).toEqual(1);
            expect(index.getVersion()).toEqual(1);
            expect(index.get().get('a')).toEqual(2);
        });

        test('a component reading a Map-valued computed re-renders after a coarse mutation', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let renders = 0;

            const index = computed<Map<string, number>>((read) => read(carburetor).index);

            class ValueView extends AntiHookComponent {
                render() {
                    renders++;

                    return <div className="value">{this.useComputed(index).get('a')}</div>;
                }
            }

            const view = render(<ValueView />);
            expect(view.container.querySelector('.value')?.textContent).toEqual('1');
            expect(renders).toEqual(1);

            act(() => carburetor.setIndex('a', 2));

            expect(view.container.querySelector('.value')?.textContent).toEqual('2');
            expect(renders).toEqual(2);

            view.unmount();
        });

        test('an equal primitive result after a recompute still stays quiet (control)', () => {
            const carburetor = new IndexedCarburetor(getIndexData());
            let notified = 0;

            const size = computed<number>((read) => read(carburetor).index.size);

            size.subscribe(() => notified++, {id: 'listener'});

            // The write lands on a tracked path and the body recomputes, but the result is the
            // same primitive: the reference check must keep suppressing the notification.
            carburetor.setIndex('a', 1);

            expect(notified).toEqual(0);
            expect(size.getVersion()).toEqual(0);
            expect(size.get()).toEqual(1);
        });
    });

    describe('live results shared across consumers (R5-03)', () => {
        interface IUserLike {
            user: {
                name: string;
                age: number;
            };
        }

        class UserCarburetor extends Carburetor<IUserLike> {
            public setName = (name: string) => {
                this.draft.user.name = name;

                this.emitUpdate();
            };

            public setAge = (age: number) => {
                this.draft.user.age = age;

                this.emitUpdate();
            };
        }

        const getUserData = (): IUserLike => ({user: {name: 'Ada', age: 30}});

        test('the second consumer stays live for the leaf it reads (name first, age second)', () => {
            const carburetor = new UserCarburetor(getUserData());
            const currentUser = computed((read) => read(carburetor).user);

            let nameRenders = 0;
            let ageRenders = 0;
            let notified = 0;

            class NameView extends AntiHookComponent {
                render() {
                    nameRenders++;

                    return <div className="name">{this.useComputed(currentUser).name}</div>;
                }
            }

            class AgeView extends AntiHookComponent {
                render() {
                    ageRenders++;

                    return <div className="age">{this.useComputed(currentUser).age}</div>;
                }
            }

            const nameView = render(<NameView />);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Ada');
            expect(nameRenders).toEqual(1);

            // The store registration is established by now; the age read below happens
            // through the still-live branch the body returned, after that fact.
            currentUser.subscribe(() => notified++, {id: 'listener'});

            const ageView = render(<AgeView />);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('30');
            expect(ageRenders).toEqual(1);

            act(() => carburetor.setAge(31));

            // The late leaf read is a real dependency: the write must wake the computed,
            // deliver once, and re-render the consumer that renders the field.
            expect(notified).toEqual(1);
            expect(ageRenders).toEqual(2);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('31');

            act(() => carburetor.setName('Grace'));

            expect(notified).toEqual(2);
            expect(nameRenders).toEqual(3);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Grace');
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('31');

            nameView.unmount();
            ageView.unmount();
        });

        test('the second consumer stays live for the leaf it reads (age first, name second)', () => {
            const carburetor = new UserCarburetor(getUserData());
            const currentUser = computed((read) => read(carburetor).user);

            let nameRenders = 0;
            let ageRenders = 0;

            class NameView extends AntiHookComponent {
                render() {
                    nameRenders++;

                    return <div className="name">{this.useComputed(currentUser).name}</div>;
                }
            }

            class AgeView extends AntiHookComponent {
                render() {
                    ageRenders++;

                    return <div className="age">{this.useComputed(currentUser).age}</div>;
                }
            }

            const ageView = render(<AgeView />);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('30');
            expect(ageRenders).toEqual(1);

            const nameView = render(<NameView />);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Ada');
            expect(nameRenders).toEqual(1);

            act(() => carburetor.setName('Grace'));

            // The name read above happened after the age reader established the
            // registration; the write must still reach the consumer that renders it.
            expect(nameRenders).toEqual(2);
            expect(nameView.container.querySelector('.name')?.textContent).toEqual('Grace');
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('30');

            act(() => carburetor.setAge(31));

            expect(ageRenders).toEqual(3);
            expect(ageView.container.querySelector('.age')?.textContent).toEqual('31');

            nameView.unmount();
            ageView.unmount();
        });

        test('a single consumer keeps updating on the field it reads (control)', () => {
            const carburetor = new UserCarburetor(getUserData());
            const currentUser = computed((read) => read(carburetor).user);

            let renders = 0;

            class NameView extends AntiHookComponent {
                render() {
                    renders++;

                    return <div className="name">{this.useComputed(currentUser).name}</div>;
                }
            }

            const view = render(<NameView />);
            expect(view.container.querySelector('.name')?.textContent).toEqual('Ada');
            expect(renders).toEqual(1);

            // A field nobody read must not wake the computed: the amendment stays precise.
            act(() => carburetor.setAge(31));
            expect(renders).toEqual(1);
            expect(view.container.querySelector('.name')?.textContent).toEqual('Ada');

            act(() => carburetor.setName('Grace'));
            expect(renders).toEqual(2);
            expect(view.container.querySelector('.name')?.textContent).toEqual('Grace');

            view.unmount();
        });
    });
});
