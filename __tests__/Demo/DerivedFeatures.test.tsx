import * as React from 'react';
import {act} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {CarburetorProvider} from "@/Carburetor";
import {TodoApp} from "@/ToDo/TodoApp";
import {ETodoFilter} from "@/ToDo/Models/Enums/ETodoFilter";
import {createTodoScope} from "@/ToDo/Scope/createTodoScope";
import {filterToken} from "@/ToDo/Scope/Tokens/filterToken";
import {todoToken} from "@/ToDo/Scope/Tokens/todoToken";
import {viewsToken} from "@/ToDo/Scope/Tokens/viewsToken";

const byTestId = (container: HTMLElement, testId: string): HTMLElement => {
    return container.querySelector('[data-testid="' + testId + '"]') as HTMLElement;
};

const allByTestId = (container: HTMLElement, testId: string): HTMLElement[] => {
    return Array.from(container.querySelectorAll('[data-testid="' + testId + '"]'));
};

const titles = (container: HTMLElement): string[] => {
    return allByTestId(container, 'todo-title').map((input: HTMLElement) => (input as HTMLInputElement).value);
};

/** The trailing number of a counter's text, e.g. "list renders: 3" → 3; throws when there is none. */
const count = (container: HTMLElement, testId: string): number => {
    const match = /(\d+)\s*$/.exec(byTestId(container, testId).textContent ?? '');

    if (!match) {
        throw new Error('no counter in ' + testId);
    }

    return Number(match[1]);
};

const mount = async () => {
    const {scope, dispose} = createTodoScope();
    const mounted = render(<CarburetorProvider scope={scope}><TodoApp/></CarburetorProvider>);

    await act(async () => undefined);

    return {scope, dispose, ...mounted};
};

describe('demo: derived values and selections', () => {
    test('a filter switch that keeps the same ids does not re-render the list', async () => {
        const {dispose, container, unmount} = await mount();
        const listBefore = count(container, 'app-renders');

        fireEvent.click(byTestId(container, 'filter-active'));

        expect(count(container, 'app-renders')).toEqual(listBefore);

        unmount();
        dispose();
    });

    test('the filter tabs narrow the list through the visibleIds computed', async () => {
        const {dispose, container, unmount} = await mount();

        fireEvent.click(allByTestId(container, 'todo-done')[0]);
        fireEvent.click(byTestId(container, 'filter-done'));

        expect(titles(container)).toEqual(['do work #1']);
        expect(byTestId(container, 'filter-done').getAttribute('aria-pressed')).toEqual('true');

        fireEvent.click(byTestId(container, 'filter-active'));
        expect(titles(container)).toEqual(['do lunch', 'do work #2', 'go home']);

        fireEvent.click(byTestId(container, 'filter-all'));
        expect(titles(container).length).toEqual(4);

        unmount();
        dispose();
    });

    test('editing a title re-renders neither the list nor the stats child', async () => {
        const {dispose, container, unmount} = await mount();
        const listBefore = count(container, 'app-renders');
        const statsBefore = count(container, 'stats-renders');

        fireEvent.change(allByTestId(container, 'todo-title')[0], {target: {value: 'renamed'}});

        expect(count(container, 'app-renders')).toEqual(listBefore);
        expect(count(container, 'stats-renders')).toEqual(statsBefore);

        unmount();
        dispose();
    });

    test('a filter switch re-renders the list but the gate skips the unchanged stats snapshot', async () => {
        const {dispose, container, unmount} = await mount();

        fireEvent.click(allByTestId(container, 'todo-done')[0]);

        const listBefore = count(container, 'app-renders');
        const statsBefore = count(container, 'stats-renders');

        fireEvent.click(byTestId(container, 'filter-active'));

        expect(count(container, 'app-renders')).toEqual(listBefore + 1);
        expect(count(container, 'stats-renders')).toEqual(statsBefore);

        unmount();
        dispose();
    });

    test('a completion flip passes the gate once and updates the hooks-based badge', async () => {
        const {dispose, container, unmount} = await mount();
        const statsBefore = count(container, 'stats-renders');

        expect(byTestId(container, 'progress-badge').textContent).toEqual('0% done of 4');

        fireEvent.click(allByTestId(container, 'todo-done')[0]);

        expect(count(container, 'stats-renders')).toEqual(statsBefore + 1);
        expect(byTestId(container, 'done-count').textContent).toEqual('1');
        expect(byTestId(container, 'progress-badge').textContent).toEqual('25% done of 4');

        unmount();
        dispose();
    });

    test('visibleIds does not re-announce when a recompute lands on the same ids (equals: shallowEqual)', async () => {
        const {scope, dispose} = createTodoScope();
        const todos = scope.get(todoToken);
        const views = scope.get(viewsToken);
        const stop = views.visibleIds.subscribe(() => undefined);

        await todos.loadData();
        scope.get(filterToken).setFilter(ETodoFilter.Active);

        const before = views.visibleIds.get();
        const versionBefore = views.visibleIds.getVersion();
        const first = todos.getData().items.workTodo1;

        todos.updateTodo({...first, title: 'still active'});

        // The body builds a fresh array every recompute (`filter` never returns the same
        // reference), so the content — not the identity — is what {equals: shallowEqual} judges:
        // the version stays put and nobody is notified.
        expect(views.visibleIds.getVersion()).toEqual(versionBefore);
        expect(views.visibleIds.get()).toEqual(before);
        expect(views.summary.get()).toEqual('0% done');

        views.visibleIds.unsubscribe(stop);
        dispose();
    });
});
