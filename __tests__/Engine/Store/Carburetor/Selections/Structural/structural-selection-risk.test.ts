import {Carburetor} from '@/Carburetor';

interface INode {value: number; link?: Map<string, INode> | INode;}
interface IData {rows: INode[]; alias: INode; tick: number;}

class RiskStore extends Carburetor<IData> {
    /** Applies one transaction.
     *
     * @param fn - draft mutation
     */
    public change(fn: (draft: IData) => void): void { this.update(fn); }
}

describe('structural selection edge cases', () => {
    test('selection containing a Map preserves native members after append', () => {
        const row: INode = {value: 0, link: new Map([['child', {value: 1}]])};
        const store = new RiskStore({rows: [row], alias: {value: 0}, tick: 0});
        let latest: INode[] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { latest = next as INode[]; });
        store.change((draft) => { draft.rows.push({value: 2}); });
        expect(latest[0].link).toBeInstanceOf(Map);
        expect((latest[0].link as Map<string, INode>).get('child')?.value).toBe(1);
        stop();
    });

    test('two aliased selection roots keep detached snapshots after selected write', () => {
        const row: INode = {value: 1};
        const store = new RiskStore({rows: [row], alias: row, tick: 0});
        let list: INode[] = [];
        let alias: INode | undefined;
        const originalError = console.error;
        let stopList: (() => void) | undefined;
        let stopAlias: (() => void) | undefined;
        try {
            console.error = () => undefined;
            stopList = store.watch(
                (data: IData) => { void data.tick; return data.rows; },
                (next) => { list = next as INode[]; }
            );
            stopAlias = store.watch(
                (data: IData) => { void data.tick; return data.alias; },
                (next) => { alias = next as INode; }
            );
            store.change((draft) => { draft.tick++; draft.rows[0].value = 2; });
        } finally {
            console.error = originalError;
            stopList?.();
            stopAlias?.();
        }
        expect(list[0].value).toBe(2);
        expect(alias?.value).toBe(2);
    });

    test('array selection reflects structural membership changes', () => {
        const store = new RiskStore({rows: [{value: 1}], alias: {value: 0}, tick: 0});
        let latest: INode[] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { latest = next as INode[]; });
        store.change((draft) => { draft.rows.push({value: 2}); });
        expect(latest.map((node) => node.value)).toEqual([1, 2]);
        stop();
    });
});
