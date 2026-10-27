import {Carburetor, TSelector} from '@react-carburetor/core';

interface IData {items: string[]}

declare const selectTodos: TSelector<IData, string[]>;
declare function onTodosChanged(next: readonly string[], previous: readonly string[]): void;

const todoCarburetor = new Carburetor<IData>({items: []});

export function demo(): void {
    // #region doc
    const stop = todoCarburetor.watch(selectTodos, onTodosChanged);

    // In the owning object's cleanup:
    stop();
    // #endregion doc
}
