import * as React from 'react';
import {act} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {CarburetorProvider, IStorageLike, waitForUpdate} from "@/Carburetor";
import {TodoApp} from "@/ToDo/TodoApp";
import {ETodoFilter} from "@/ToDo/Models/Enums/ETodoFilter";
import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {createTodoScope} from "@/ToDo/Scope/createTodoScope";
import {filterToken} from "@/ToDo/Scope/Tokens/filterToken";
import {statusToken} from "@/ToDo/Scope/Tokens/statusToken";
import {todoToken} from "@/ToDo/Scope/Tokens/todoToken";
import {viewsToken} from "@/ToDo/Scope/Tokens/viewsToken";

const byTestId = (container: HTMLElement, testId: string): HTMLElement => {
    return container.querySelector('[data-testid="' + testId + '"]') as HTMLElement;
};

const allByTestId = (container: HTMLElement, testId: string): HTMLElement[] => {
    return Array.from(container.querySelectorAll('[data-testid="' + testId + '"]'));
};

/** A storage whose contents a test can inspect. */
interface IMemoryStorage extends IStorageLike {
    items: Record<string, string>;
}

/** An in-memory storage with the three methods persist() uses. */
const memoryStorage = (initial: Record<string, string> = {}): IMemoryStorage => {
    const items: Record<string, string> = {...initial};

    return {
        items,
        getItem: (key: string) => (key in items ? items[key] : null),
        setItem: (key: string, value: string) => {
            items[key] = value;
        },
        removeItem: (key: string) => {
            delete items[key];
        },
    };
};

const mount = async (storage?: IStorageLike) => {
    const {scope, dispose} = createTodoScope(new MockToDoClientAPI(), storage);
    const mounted = render(<CarburetorProvider scope={scope}><TodoApp/></CarburetorProvider>);

    await act(async () => undefined);

    return {scope, dispose, ...mounted};
};

/** Lets emitSoon() publications land. */
const flush = async (): Promise<void> => {
    await act(async () => undefined);
};

describe('demo: writes and tooling', () => {
    test('complete all, then undo and redo it through the toolbar', async () => {
        const {dispose, container, unmount} = await mount();

        expect((byTestId(container, 'undo') as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(byTestId(container, 'complete-all'));
        await flush();

        expect(byTestId(container, 'done-count').textContent).toEqual('4');
        expect((byTestId(container, 'undo') as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(byTestId(container, 'undo'));
        await flush();

        expect(byTestId(container, 'done-count').textContent).toEqual('0');
        expect((byTestId(container, 'redo') as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(byTestId(container, 'redo'));
        await flush();

        expect(byTestId(container, 'done-count').textContent).toEqual('4');

        unmount();
        dispose();
    });

    test('clear completed and the filter reset reach observers as one change', async () => {
        const {scope, dispose} = createTodoScope();
        const todos = scope.get(todoToken);
        const views = scope.get(viewsToken);
        const delivered: number[] = [];

        await todos.loadData();

        const stop = views.visibleIds.subscribe(() => {
            delivered.push(views.visibleIds.get().length);
        });

        todos.updateTodo({...todos.getData().items.workTodo1, done: true});
        scope.get(filterToken).setFilter(ETodoFilter.Done);
        delivered.length = 0;

        const {container, unmount} = render(<CarburetorProvider scope={scope}><TodoApp/></CarburetorProvider>);
        fireEvent.click(byTestId(container, 'clear-completed'));

        // Without the transaction the intermediate "Done filter, nothing left" state (0) would
        // be delivered before the reset to All (3).
        expect(delivered).toEqual([3]);
        expect(scope.get(filterToken).getData().filter).toEqual(ETodoFilter.All);

        views.visibleIds.unsubscribe(stop);
        unmount();
        dispose();
    });

    test('Ctrl+Z undoes outside text fields and stops after unmount', async () => {
        const {scope, dispose, container, unmount} = await mount();
        const todos = scope.get(todoToken);

        fireEvent.click(allByTestId(container, 'todo-done')[0]);
        await flush();

        fireEvent.keyDown(allByTestId(container, 'todo-title')[0], {key: 'z', ctrlKey: true});
        expect(todos.getData().doneCount).toEqual(1);

        fireEvent.keyDown(document.body, {key: 'z', ctrlKey: true});
        expect(todos.getData().doneCount).toEqual(0);

        fireEvent.keyDown(document.body, {key: 'y', ctrlKey: true});
        expect(todos.getData().doneCount).toEqual(1);

        unmount();
        fireEvent.keyDown(document.body, {key: 'z', ctrlKey: true});
        expect(todos.getData().doneCount).toEqual(1);

        dispose();
    });

    test('the filter is restored from storage and written back on change', async () => {
        const storage = memoryStorage({'todo-demo:filter': JSON.stringify({filter: ETodoFilter.Done})});
        const {dispose, container, unmount} = await mount(storage);

        expect(byTestId(container, 'filter-done').getAttribute('aria-pressed')).toEqual('true');

        fireEvent.click(byTestId(container, 'filter-active'));

        expect(JSON.parse(storage.items['todo-demo:filter'])).toEqual({filter: ETodoFilter.Active});

        unmount();
        dispose();
    });

    test('the throttled emit status is delivered after its window', async () => {
        const {scope, dispose, container, unmount} = await mount();
        const status = scope.get(statusToken);
        const before = byTestId(container, 'emitted-message').textContent;

        // Millisecond timestamps: move the clock past the load's own value, or the write is no change.
        await act(async () => {
            await new Promise<void>((resolve: () => void) => {
                setTimeout(resolve, 5);
            });
        });

        // Subscribe before the write: the throttle queues deliveries per subscriber at write time.
        const delivered = waitForUpdate(status);

        fireEvent.click(byTestId(container, 'add-todo'));

        await act(async () => {
            await delivered;
        });

        expect(byTestId(container, 'emitted-message').textContent).not.toEqual(before);

        unmount();
        dispose();
    });
});
