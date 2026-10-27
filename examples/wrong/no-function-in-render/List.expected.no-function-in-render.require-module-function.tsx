// #region doc
import {AntiHookComponent, bind} from '@react-carburetor/core';

interface Item { id: string; name: string }
const renderRow = (item: Item): React.ReactElement => <ItemRow key={item.id} item={item}/>;

declare function pick(id: string): void;

// Intentional anti-pattern: inline map callback and handler allocate during render.
export class BadList extends AntiHookComponent<{items: Item[]}> {
    public render() {
        return <ul>{this.props.items.map((item) =>
            <li key={item.id} onClick={() => pick(item.id)}>{item.name}</li>)}</ul>;
    }
}

class ItemRow extends AntiHookComponent<{item: Item}> {
    @bind
    private onClick(): void { pick(this.props.item.id); }

    public render() {
        return <li onClick={this.onClick}>{this.props.item.name}</li>;
    }
}

export class ItemList extends AntiHookComponent<{items: Item[]}> {
    public render() {
        return <ul>{this.props.items.map(renderRow)}</ul>;
    }
}
// #endregion doc
