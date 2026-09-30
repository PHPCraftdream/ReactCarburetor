import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, computed, transaction} from '@/Carburetor';
import {ListCarburetor, getData} from './fixtures';

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

    test('a chain of computeds stays quiet when a title write touches neither computed (R16-01)', () => {
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

        // Enumerating `items` subscribes to its key-set marker, not its own path (R16-01): a
        // title write changes no key, so the inner computed is not even asked to recompute,
        // and the outer one — reading only the inner's value — stays quiet too.
        carburetor.setTitle('a', 'renamed');

        expect(innerRuns).toEqual(1);
        expect(outerRuns).toEqual(1);
        expect(notified).toEqual(0);

        carburetor.setDone('a', true);

        expect(innerRuns).toEqual(2);
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

    test('a subscriber that unsubscribes a later one during delivery skips it for this delivery', () => {
        const carburetor = new ListCarburetor(getData());
        let secondCalls = 0;

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        doneCount.subscribe(() => doneCount.unsubscribe('second'), {id: 'first'});
        doneCount.subscribe(() => secondCalls++, {id: 'second'});

        carburetor.setDone('a', true);

        // 'second' was still registered when this delivery started, but 'first' unsubscribed
        // it before its own turn came, so it is skipped instead of woken.
        expect(secondCalls).toEqual(0);
    });

    test('a subscriber that subscribes a new listener during delivery does not wake it until the next delivery', () => {
        const carburetor = new ListCarburetor(getData());
        let joinerCalls = 0;
        let joined = false;

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        doneCount.subscribe(() => {
            if (!joined) {
                joined = true;
                doneCount.subscribe(() => joinerCalls++, {id: 'joiner'});
            }
        }, {id: 'first'});

        carburetor.setDone('a', true);

        // The joiner subscribed mid-delivery, after this pass's subscriber list was captured.
        expect(joinerCalls).toEqual(0);

        carburetor.setDone('a', false);

        expect(joinerCalls).toEqual(1);
    });

    test('replacing a pending subscriber under the same id cancels its old publication', () => {
        const store = new ListCarburetor(getData());
        const value = computed(read => read(store).items.a.done);
        const seen: string[] = [];

        value.subscribe(() => {
            const current = value.get();
            seen.push(`first:${current}`);
            if (current) {
                value.subscribe(() => seen.push(`replacement:${value.get()}`), {id: 'target'});
            }
        }, {id: 'first'});
        value.subscribe(() => seen.push(`old:${value.get()}`), {id: 'target'});

        store.setDone('a', true);
        expect(seen).toEqual(['first:true']);
        expect(value.getVersion()).toEqual(1);

        store.setDone('a', false);
        expect(seen).toEqual(['first:true', 'first:false', 'replacement:false']);
        expect(value.getVersion()).toEqual(2);
    });

    test('readded and newly joined listeners receive a nested new publication, not the old one', () => {
        const store = new ListCarburetor(getData());
        const value = computed(read => read(store).items.a.done);
        const seen: string[] = [];

        value.subscribe(() => {
            const current = value.get();
            seen.push(`first:${current}`);
            if (current) {
                value.unsubscribe('target');
                value.subscribe(() => seen.push(`readded:${value.get()}`), {id: 'target'});
                value.subscribe(() => seen.push(`joined:${value.get()}`), {id: 'joined'});
                store.setDone('a', false);
            }
        }, {id: 'first'});
        value.subscribe(() => seen.push(`old:${value.get()}`), {id: 'target'});

        store.setDone('a', true);

        expect(seen).toEqual(['first:true', 'first:false', 'readded:false', 'joined:false']);
        expect(value.getVersion()).toEqual(2);
    });

    test('a joiner replacing a leaver during delivery still waits for the next delivery', () => {
        const carburetor = new ListCarburetor(getData());
        let joinerCalls = 0;

        const doneCount = computed<number>((read) => {
            const {items} = read(carburetor);

            return Object.keys(items).filter((id: string) => items[id].done).length;
        });

        doneCount.subscribe(() => {
            doneCount.unsubscribe('leaver');
            doneCount.subscribe(() => joinerCalls++, {id: 'joiner'});
        }, {id: 'first'});
        doneCount.subscribe(() => undefined, {id: 'leaver'});

        carburetor.setDone('a', true);

        // Same subscriber count as at the start, but the joiner was not part of this pass.
        expect(joinerCalls).toEqual(0);
    });

});
