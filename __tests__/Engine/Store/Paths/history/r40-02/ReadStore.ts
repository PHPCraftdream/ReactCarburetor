import {Carburetor} from '@/Carburetor';
import {S} from '@/Carburetor/Store/Diagnostics/Internal/StoreIdentity';
import {ISubscribeOptions} from '@/Carburetor/Models/Store';
import {TSubscriber} from '@/Carburetor/Models/Base';

interface IRow {title: string; done: boolean; owner: {name: string}}
interface IData {items: Record<string, IRow>; filter: {text: string}; user?: {name: string}}

/** Captures actual subscription handoffs for R40-02. */
export class ReadStore extends Carburetor<IData> {
    public readonly filed: string[][] = [];

    constructor(count = 3) {
        const items: IData['items'] = {};
        for (let i = 0; i < count; i++) {
            items['r' + i] = {title: 't' + i, done: i % 3 === 0, owner: {name: 'n' + i}};
        }
        super({items, filter: {text: ''}, user: {name: 'u'}});
    }

    /** Publishes one synchronous mutation. */
    public change(body: (draft: IData) => void): void { this.update(body); }

    /** Captures paths at the public subscription boundary. */
    public override subscribe(callback: TSubscriber, options: ISubscribeOptions = {}): string {
        if (options.reads) this.filed.push([...options.reads]);
        return super.subscribe(callback, options);
    }

    /** Index retention counters, without changing production visibility. */
    public indexSizes(): number[] {
        const index = this[S.subscriberIndex] as unknown as {
            exact: Map<string, unknown>; branch: Map<string, unknown>;
            readsById: Map<string, unknown>; wildcard: Set<string>;
        };
        return [index.exact.size, index.branch.size, index.readsById.size, index.wildcard.size];
    }
}
