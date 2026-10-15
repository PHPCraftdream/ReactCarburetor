import {AntiHookComponent, Carburetor} from 'react-carburetor';

class Todos extends Carburetor<{orderIds: string[]}> {
    public toggle(id: string): void {
        const at = this.draft.orderIds.indexOf(id);

        if (at >= 0) this.draft.orderIds.splice(at, 1);
        this.emitUpdate();
    }
}

const todoCarburetor = new Todos({orderIds: []});

export class WrongHandler extends AntiHookComponent {
    // #region doc
    private onClick = () => {
        const data = this.useCarburetor(todoCarburetor);

        todoCarburetor.toggle(data.orderIds[0]);
    };
    // #endregion doc

    public render() {
        return null;
    }
}
