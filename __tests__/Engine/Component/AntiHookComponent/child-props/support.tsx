import {Carburetor, IDict} from '@/Carburetor';

export interface IRow {
    title: string;
    done: boolean;
}

export interface IRowList {
    items: IDict<IRow>;
}

export class RowListCarburetor extends Carburetor<IRowList> {
    public subscriberCount = (): number => Object.keys(this.subscribers).length;

    public rename = (id: string, title: string): void => {
        this.draft.items[id] = {...this.getData().items[id], title};
        this.emitUpdate();
    };

    public renameLeaf = (id: string, title: string): void => {
        this.draft.items[id].title = title;
        this.emitUpdate();
    };
}

export const getListData = (): IRowList => ({
    items: {
        a: {title: 'Ann', done: false},
        b: {title: 'Bea', done: false},
    },
});
