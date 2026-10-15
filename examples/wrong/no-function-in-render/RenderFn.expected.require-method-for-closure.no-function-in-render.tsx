import {AntiHookComponent} from 'react-carburetor';

interface Item {id: string; name: string}

declare const items: Item[];

export class WrongRenderFns extends AntiHookComponent<{onPick(id: string): void}> {
    private pick(id: string): void {
        this.props.onPick(id);
    }

    public render() {
        // #region doc
        return <ul>{items.map((item) =>
            <li key={item.id} onClick={() => this.pick(item.id)}>{item.name}</li>)}</ul>;
        // #endregion doc
    }
}
