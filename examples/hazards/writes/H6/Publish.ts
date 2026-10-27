import {Carburetor} from '@react-carburetor/core';

interface IToggleState {items: Record<string, {done: boolean}>}

export class Todos extends Carburetor<IToggleState> {
    // #region doc
    public toggle = (id: string) => {
        this.draft.items[id].done = !this.draft.items[id].done;

        this.emitUpdate();
    };
    // #endregion doc
}
