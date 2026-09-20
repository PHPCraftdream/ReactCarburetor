import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, computed, transaction} from "../../lib/src/Carburetor";

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

        doneCount.subscribe(() => undefined, 'listener');
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

        doneCount.subscribe(() => notified++, 'listener');

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

        doneCount.subscribe(() => undefined, 'listener');
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

        doneCount.subscribe(() => undefined, 'listener');
        expect(runs).toEqual(1);

        transaction(() => {
            carburetor.setDone('a', true);
            carburetor.setTitle('a', 'x');
            carburetor.setTitle('b', 'y');
        });

        expect(runs).toEqual(2);
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
});
