import {Carburetor} from '@/Carburetor';
import {ISubscribeOptions} from '@/Carburetor/Models/Store';
import {TSubscriber} from '@/Carburetor/Models/Base';
import {TPath} from '@/Carburetor/Models/Paths';
import {readCoverage} from '@/Carburetor/Store/Paths/Markers/readCoverage';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';

export interface IRow {
    id: number;
    title: string;
    owner: {name: string};
}

export interface IListData {
    items: IRow[];
    titles: boolean;
    showExtra: boolean;
    extra: number;
}

const NativeSet = globalThis.Set;
const rawSlice = String.prototype.slice;
const prune = readCoverage.prune;

/** A list store that records every read set it is asked to file. */
export class ListStore extends Carburetor<IListData> {
    public subscribed: Set<TPath>[] = [];

    private readonly baseSubscribe = this.subscribe;

    public subscribe = (callback: TSubscriber, options: ISubscribeOptions = {}): string => {
        this.subscribed.push(new NativeSet<TPath>(options.reads ?? []));
        return this.baseSubscribe(callback, options);
    };

    public run = (mutate: (draft: IListData) => void): void => {
        this.update(mutate);
    };

    public subscriberCount = (): number => Object.keys(this[S.subscribers]).length;
}

export const makeStore = (rows: number): ListStore => new ListStore({
    items: Array.from({length: rows}, (_, id) => ({id, title: 't' + id, owner: {name: 'n' + id}})),
    titles: true,
    showExtra: false,
    extra: 0,
});

/** Set constructions, slice calls and read-set prunes inside one counted window. */
const counters = {sets: 0, slices: 0, prunes: 0};

/** Starts counting Set constructions, `String.prototype.slice` calls and prunes from zero. */
export const begin = (): void => {
    counters.sets = counters.slices = counters.prunes = 0;
    globalThis.Set = class extends NativeSet<unknown> {
        constructor(values?: Iterable<unknown> | null) {
            super(values);
            counters.sets++;
        }
    } as SetConstructor;
    String.prototype.slice = function (this: string, ...args: [number?, number?]): string {
        counters.slices++;
        return rawSlice.apply(this, args);
    };
    readCoverage.prune = (reads) => {
        counters.prunes++;
        prune(reads);
    };
};

/** Stops counting and returns what the window saw. */
export const end = (): {sets: number; slices: number; prunes: number} => {
    globalThis.Set = NativeSet;
    String.prototype.slice = rawSlice;
    readCoverage.prune = prune;
    return {...counters};
};

/** Counts `work` from zero. */
export const measure = (work: () => void): {sets: number; slices: number; prunes: number} => {
    begin();
    try {
        work();
    } finally {
        end();
    }
    return {...counters};
};
