import {AntiHookComponent, Carburetor} from '@react-carburetor/core';

class Todos extends Carburetor<{ids: string[]}> {
    public toggle(id: string): void {
        const at = this.draft.ids.indexOf(id);

        if (at >= 0) this.draft.ids.splice(at, 1);
        this.emitUpdate();
    }
}

// #region doc
export class Row extends AntiHookComponent<{carburetor: Todos; id: string}> {
    protected onToggle(): void {
        this.props.carburetor.toggle(this.props.id);       // `this` is undefined here
    }

    public render() {
        return <button onClick={this.onToggle}>toggle</button>;
    }
}
// #endregion doc
