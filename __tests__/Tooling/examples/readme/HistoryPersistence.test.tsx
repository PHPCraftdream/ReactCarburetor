import {act} from 'react';
import {expect, test} from '@rstest/core';
import {CarburetorHistory, waitForUpdate} from '@/Carburetor';
import {TodoCarburetor} from '../../../../examples/readme/Core/TodoStore';

const makeInitial = () => ({
    orderIds: ['a', 'b'],
    activeCount: 1,
    items: {a: {title: 'A', done: false}, b: {title: 'B', done: true}},
});

describe('README history scenario over the TodoStore example', () => {
    test('undo restores the previous title and redo reapplies it', async () => {
        const store = new TodoCarburetor(makeInitial());
        const history = new CarburetorHistory(store);

        await act(async () => {
            const delivered = waitForUpdate(store);
            store.renameTodo('a', 'A2');
            await delivered;
        });
        expect(store.getData().items.a.title).toEqual('A2');
        expect(history.canUndo()).toBe(true);

        await act(async () => {
            history.undo();
        });
        expect(store.getData().items.a.title).toEqual('A');
        expect(history.canRedo()).toBe(true);

        await act(async () => {
            history.redo();
        });
        expect(store.getData().items.a.title).toEqual('A2');

        history.disconnect();
    });
});

describe('README persistence scenario over the TodoStore example', () => {
    test('the wire form round-trips through restore into a fresh store', () => {
        // persist() stores JSON.stringify(store) — the wire form via toJSON() — and
        // restores parsed JSON through restore(); exercise that contract directly.
        const store = new TodoCarburetor(makeInitial());
        store.renameTodo('a', 'A2');

        const wire = JSON.stringify(store);
        expect(JSON.parse(wire).items.a.title).toEqual('A2');

        const restored = new TodoCarburetor(makeInitial());
        restored.restore(JSON.parse(wire));
        expect(restored.getData().items.a.title).toEqual('A2');
    });
});
