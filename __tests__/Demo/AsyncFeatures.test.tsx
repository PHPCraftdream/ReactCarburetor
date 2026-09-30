import * as React from 'react';
import {act} from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react';
import {CarburetorProvider, EResourceStatus} from "@/Carburetor";
import {ITodoDetails, IToDoClientAPI, ITodoList} from "@/ToDo/API/Models";
import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {TodoApp} from "@/ToDo/TodoApp";
import {createTodoScope} from "@/ToDo/Scope/createTodoScope";
import {todoToken} from "@/ToDo/Scope/Tokens/todoToken";

const byTestId = (container: HTMLElement, testId: string): HTMLElement => {
    return container.querySelector('[data-testid="' + testId + '"]') as HTMLElement;
};

const allByTestId = (container: HTMLElement, testId: string): HTMLElement[] => {
    return Array.from(container.querySelectorAll('[data-testid="' + testId + '"]'));
};

const mount = (api: IToDoClientAPI) => {
    const {scope, dispose} = createTodoScope(api);
    const mounted = render(<CarburetorProvider scope={scope}><TodoApp/></CarburetorProvider>);

    return {scope, dispose, ...mounted};
};

/** A list API whose first answer fails, then behaves like the mock. */
class FlakyListAPI extends MockToDoClientAPI {
    public failuresLeft: number = 1;

    public getTodoList = (): Promise<ITodoList> => {
        if (this.failuresLeft > 0) {
            this.failuresLeft--;

            return Promise.reject(new Error('server down'));
        }

        return new MockToDoClientAPI().getTodoList();
    };
}

/** Counts detail requests per id. */
class CountingDetailsAPI extends MockToDoClientAPI {
    public calls: string[] = [];

    public getTodoDetails = (id: string): Promise<ITodoDetails> => {
        this.calls.push(id);

        const checkedAt = new Date(2026, 0, 1, 10, 0, this.calls.length).toISOString();

        return Promise.resolve({id, estimateMinutes: 7, checkedAt});
    };
}

describe('demo: async resources', () => {
    test('the list request shows its status and can be cancelled, then reloaded', async () => {
        const {scope, dispose, container, unmount} = mount(new MockToDoClientAPI(30));

        expect(byTestId(container, 'list-status').textContent).toContain('Loading');

        fireEvent.click(byTestId(container, 'list-cancel'));

        expect(scope.get(todoToken).list.getData().status).toEqual(EResourceStatus.Idle);
        expect(allByTestId(container, 'todo-item').length).toEqual(0);
        expect(byTestId(container, 'list-status').textContent).toContain('Not loaded');

        fireEvent.click(byTestId(container, 'list-reload'));

        await waitFor(() => expect(allByTestId(container, 'todo-item').length).toEqual(4));
        expect(byTestId(container, 'list-status').textContent).toContain('Synced');

        unmount();
        dispose();
    });

    test('a failed load keeps the list and offers a retry', async () => {
        const api = new FlakyListAPI();
        const {dispose, container, unmount} = mount(api);

        await waitFor(() => {
            expect(byTestId(container, 'list-status').textContent).toContain('Load failed: server down');
        });
        expect(allByTestId(container, 'todo-item').length).toEqual(0);

        fireEvent.click(byTestId(container, 'list-reload'));

        await waitFor(() => expect(allByTestId(container, 'todo-item').length).toEqual(4));

        unmount();
        dispose();
    });

    test('details load after the commit, refresh in place, and go stale on reload', async () => {
        const api = new CountingDetailsAPI();
        const {dispose, container, unmount} = mount(api);

        await act(async () => undefined);

        fireEvent.click(allByTestId(container, 'todo-details-toggle')[0]);

        await waitFor(() => expect(byTestId(container, 'todo-details-body').textContent).toContain('≈ 7 min'));
        expect(api.calls).toEqual(['workTodo1']);

        fireEvent.click(byTestId(container, 'todo-details-refresh'));
        await waitFor(() => expect(api.calls.length).toEqual(2));

        // Reload marks every entry stale; the one on screen refetches itself, nothing else does.
        fireEvent.click(byTestId(container, 'list-reload'));
        await waitFor(() => expect(api.calls).toEqual(['workTodo1', 'workTodo1', 'workTodo1']));

        unmount();
        dispose();
    });
});
