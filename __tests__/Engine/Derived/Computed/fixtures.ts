import {Carburetor} from "@/Carburetor";

export interface ITodoLike {
    items: {
        [id: string]: {
            title: string;
            done: boolean;
        };
    };
}

export const getData = (): ITodoLike => ({
    items: {
        a: {title: 'a', done: false},
        b: {title: 'b', done: true},
    },
});

export class ListCarburetor extends Carburetor<ITodoLike> {
    public setTitle = (id: string, title: string) => {
        this.draft.items[id].title = title;

        this.emitUpdate();
    };

    public setDone = (id: string, done: boolean) => {
        this.draft.items[id].done = done;

        this.emitUpdate();
    };

    /** Replaces the whole item object, the way a real store's "save the record" write does. */
    public replaceItem = (id: string, item: {title: string; done: boolean}) => {
        this.draft.items[id] = item;

        this.emitUpdate();
    };
}

export class CounterCarburetor extends Carburetor<{n: number}> {
    public setN = (n: number) => {
        this.draft.n = n;

        this.emitUpdate();
    };
}

interface IIndexedData {
    index: Map<string, number>;
}

export const getIndexData = (): IIndexedData => ({index: new Map([['a', 1]])});

export class IndexedCarburetor extends Carburetor<IIndexedData> {
    public setIndex = (key: string, value: number) => {
        this.draft.index.set(key, value);

        this.emitUpdate();
    };
}

export const delta = (before: number[], after: number[]): number[] =>
    after.map((count: number, index: number): number => count - before[index]);
