// #region doc
import * as React from 'react';
import {AntiHookComponent, Carburetor} from 'react-carburetor';

interface IItemListData {
    items: Array<{id: string; title: string}>;
}

const list = new Carburetor<IItemListData>({
    items: [{id: 'a1', title: 'First'}],
});

interface ITitleProps {
    title: string;
}

const Title = React.memo(function Title(props: ITitleProps) {
    return <span>{props.title}</span>;
});

class ItemTitle extends AntiHookComponent {
    private readonly row = this.connectSelection(
        list,
        (data) => ({title: data.items[0].title}),
    );

    public render() {
        return <Title title={this.row().title}/>;
    }
}
// #endregion doc

void ItemTitle;
