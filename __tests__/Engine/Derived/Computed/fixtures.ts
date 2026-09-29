import {Carburetor} from "@/Carburetor";
import {IComputed} from '@/Carburetor/Models/Derived';
import {ISubscribeOptions} from '@/Carburetor/Models/Store';

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

    /**
     * Touches `done` twice in one emit, ending at the value it started with: the field a
     * dependency reads is recorded as written, while its net value does not change.
     */
    public toggleDoneAndBack = (id: string) => {
        this.update((draft: ITodoLike) => {
            draft.items[id].done = !draft.items[id].done;
            draft.items[id].done = !draft.items[id].done;
        });
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

export class ExternalComputed implements IComputed<number> {
    public listeners = new Map<string, () => void>();
    public version = 0;
    public failSubscribe = false;
    public constructor(public value = 7, private uid = 'external') {}
    public getUID = () => this.uid;
    public getVersion = () => this.version;
    public get = () => this.value;
    public subscribe = (callback: () => void, options: ISubscribeOptions = {}) => {
        const id = options.id || 'external-listener';
        this.listeners.set(id, callback);
        if (this.failSubscribe) {
            throw new Error('attachment failed');
        }
        return id;
    };
    public unsubscribe = (id: string) => { this.listeners.delete(id); };
    public set(value: number): void {
        this.value = value;
        this.version++;
        for (const callback of Array.from(this.listeners.values())) {
            callback();
        }
    }
}
