import {act, render} from '@testing-library/react';
import {expect, test} from '@rstest/core';
import {AntiHookComponent} from '@/Carburetor';
import {TodoCarburetor} from '../../../../examples/readme/Core/TodoStore';

const initial = {
    orderIds: ['a', 'b'],
    activeCount: 1,
    items: {a: {title: 'A', done: false}, b: {title: 'B', done: true}},
};

describe('README useCarburetor subscription precision (examples/readme/Core/TodoStore.ts)', () => {
    test('renameTodo wakes only the reader of the changed path', () => {
        const store = new TodoCarburetor(initial);
        let orderRenders = 0;
        let itemRenders = 0;

        class OrderReader extends AntiHookComponent {
            public render() {
                orderRenders++;
                const {orderIds} = this.useCarburetor(store);
                return <span className="order">{orderIds.join(',')}</span>;
            }
        }

        class ItemReader extends AntiHookComponent {
            public render() {
                itemRenders++;
                const data = this.useCarburetor(store);
                return <span className="item">{data.items.a.title}</span>;
            }
        }

        const {container, unmount} = render(<div><OrderReader/><ItemReader/></div>);
        expect(orderRenders).toEqual(1);
        expect(itemRenders).toEqual(1);
        expect(container.querySelector('.item')?.textContent).toEqual('A');

        act(() => {
            store.renameTodo('a', 'A2');
        });
        expect(container.querySelector('.item')?.textContent).toEqual('A2');
        expect(itemRenders).toEqual(2);
        expect(orderRenders).toEqual(1);

        // An untouched field publishes nothing to readers that never read it.
        act(() => {
            store.setData({...store.getData(), activeCount: 2});
        });
        expect(orderRenders).toEqual(1);
        expect(itemRenders).toEqual(2);

        unmount();
    });
});
