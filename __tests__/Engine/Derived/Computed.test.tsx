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
});
