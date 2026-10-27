import {AntiHookComponent, Carburetor} from '@react-carburetor/core';

class Todos extends Carburetor<{items: string[]}> {}

const todoCarburetor = new Todos({items: []});

export class WrongEscape extends AntiHookComponent {
    private lastData: unknown;

    public render() {
        // #region doc
        const data = this.useCarburetor(todoCarburetor);

        this.lastData = data;                       // kept across renders


        // #endregion doc

        return <span>{data.items.length}</span>;
    }
}
