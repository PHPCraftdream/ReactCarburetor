import * as React from 'react';
import {act} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {MockToDoClientAPI} from "@/ToDo/API/MockToDoClientAPI";
import {TodoApp} from "@/ToDo/TodoApp";
import {TodoCarburetor} from "@/ToDo/Carburetors/TodoCarburetor";

const renderApp = async () => {
    const carburetor = new TodoCarburetor(new MockToDoClientAPI());
    const mounted = render(<TodoApp carburetor={carburetor} />);

    // loadData is fired from useEffects on mount — wait for the API response.
    await act(async () => undefined);

    return {carburetor, ...mounted};
};

const allByTestId = (container: HTMLElement, testId: string): Element[] => {
    return Array.from(container.querySelectorAll('[data-testid="' + testId + '"]'));
};

const byTestId = (container: HTMLElement, testId: string): Element => {
    return container.querySelector('[data-testid="' + testId + '"]') as Element;
};

const titles = (container: HTMLElement): string[] => {
    return allByTestId(container, 'todo-title').map((input: Element) => (input as HTMLInputElement).value);
};

const rowRenders = (container: HTMLElement): number[] => {
    return allByTestId(container, 'todo-renders').map((node: Element) => Number(node.textContent));
};

describe('<TodoApp />', () => {
    test('loads todos through the carburetor', async () => {
        const {container, unmount} = await renderApp();

        expect(titles(container)).toEqual(['do work #1', 'do lunch', 'do work #2', 'go home']);
        expect(byTestId(container, 'active-count').textContent).toEqual('4');
        expect(byTestId(container, 'done-count').textContent).toEqual('0');

        unmount();
    });

    test('creates a todo on top of the list', async () => {
        const {container, unmount} = await renderApp();

        fireEvent.click(byTestId(container, 'add-todo'));

        expect(titles(container)).toEqual(['', 'do work #1', 'do lunch', 'do work #2', 'go home']);
        expect(byTestId(container, 'active-count').textContent).toEqual('5');

        unmount();
    });

    test('edits a title through updateTodo', async () => {
        const {container, unmount} = await renderApp();

        const input = allByTestId(container, 'todo-title')[0] as HTMLInputElement;
        fireEvent.change(input, {target: {value: 'do work #1 edited'}});

        expect(titles(container)[0]).toEqual('do work #1 edited');

        unmount();
    });

    test('editing one todo re-renders only its own row', async () => {
        const {container, unmount} = await renderApp();

        const before = rowRenders(container);
        expect(before.length).toEqual(4);

        const input = allByTestId(container, 'todo-title')[1] as HTMLInputElement;
        fireEvent.change(input, {target: {value: 'do lunch twice'}});

        const after = rowRenders(container);

        // Only the second row re-rendered; the others were left untouched.
        expect(after[1]).toEqual(before[1] + 1);
        expect(after[0]).toEqual(before[0]);
        expect(after[2]).toEqual(before[2]);
        expect(after[3]).toEqual(before[3]);

        unmount();
    });

    test('marking a todo done moves it down and updates counters', async () => {
        const {container, unmount} = await renderApp();

        fireEvent.click(allByTestId(container, 'todo-done')[0]);

        expect(byTestId(container, 'active-count').textContent).toEqual('3');
        expect(byTestId(container, 'done-count').textContent).toEqual('1');
        expect(titles(container)).toEqual(['do lunch', 'do work #2', 'go home', 'do work #1']);

        unmount();
    });

    test('deletes a todo', async () => {
        const {container, unmount} = await renderApp();

        fireEvent.click(allByTestId(container, 'todo-delete')[0]);

        expect(titles(container)).toEqual(['do lunch', 'do work #2', 'go home']);
        expect(byTestId(container, 'active-count').textContent).toEqual('3');

        unmount();
    });
});
