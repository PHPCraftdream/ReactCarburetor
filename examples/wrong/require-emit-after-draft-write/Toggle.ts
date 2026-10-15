import {Carburetor} from 'react-carburetor';

interface IToggleState {items: Record<string, {done: boolean}>}

export class WrongTodos extends Carburetor<IToggleState> {
    // #region doc
    public toggle = (id: string) => {
        this.draft.items[id].done = !this.data.items[id].done;
    };
    // #endregion doc
}
