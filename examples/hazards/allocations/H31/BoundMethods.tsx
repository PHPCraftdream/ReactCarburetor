import type {JSX} from 'react';
import {AntiHookComponent, bind} from 'react-carburetor';

interface Item {id: string; name: string}

declare const items: Item[];

class ItemRow extends AntiHookComponent<{item: Item; onPick(id: string): void}> {
    public render() {
        return <span>{this.props.item.name}</span>;
    }
}

export class GoodRows extends AntiHookComponent<{onPick(id: string): void}> {
    // #region doc
    @bind
    private pick(id: string): void {
        this.props.onPick(id);
    }

    @bind
    private renderRow(item: Item): JSX.Element {
        return <ItemRow item={item} onPick={this.pick}/>;
    }

    public render() {
        return <ul>{items.map(this.renderRow)}</ul>;
    }
    // #endregion doc
}
