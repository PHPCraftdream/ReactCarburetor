import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {CARBURETOR_TARGETS_SINCE, CARBURETOR_TRACK_TARGETS} from '@/Carburetor/Store/Utils/Models';

interface IData {
    nested: {leaf: {n: number}};
    left: number;
    right: number;
    unread: number;
}

class Store extends Carburetor<IData> {
    public bumpUnread(): void { this.update(data => { data.unread++; }); }
    public setRight(n: number): void { this.update(data => { data.right = n; }); }
    public setLeaf(n: number): void { this.update(data => { data.nested.leaf.n = n; }); }
}

const makeStore = (n: number): Store => new Store({nested: {leaf: {n}}, left: 1, right: 1, unread: 0});
const graph = (data: IData) => data.nested;
const left = (data: IData) => data.left;
const right = (data: IData) => data.right;

const recordsProof = (source: Store): boolean => {
    const raw = source.getData();
    const version = source.getVersion();
    source.bumpUnread();
    const targets = source[CARBURETOR_TARGETS_SINCE](version);
    return targets !== undefined && Array.from(targets.values()).some(set => set.has(raw));
};

describe('store hook commit boundary', () => {
    it('owns real graph write proofs in layout and releases on source swap and unmount', () => {
        const first = makeStore(7);
        const second = makeStore(9);
        const cheap = makeStore(0);
        expect(recordsProof(cheap)).toBe(false);
        const release = cheap[CARBURETOR_TRACK_TARGETS]();
        expect(recordsProof(cheap)).toBe(true);
        release();
        expect(recordsProof(cheap)).toBe(false);
        const witnessed: Store[] = [];
        function Owner({source}: {source: Store}): React.ReactElement {
            const value = useCarburetorValue(source, graph);
            React.useLayoutEffect(() => {
                expect(recordsProof(source)).toBe(true);
                witnessed.push(source);
            }, [source]);
            return <p>{value.leaf.n}</p>;
        }
        const view = render(<Owner source={first}/>);
        expect(view.container.textContent).toBe('7');
        act(() => first.setLeaf(8));
        expect(view.container.textContent).toBe('8');
        view.rerender(<Owner source={second}/>);
        expect(view.container.textContent).toBe('9');
        expect(witnessed).toEqual([first, second]);
        expect(recordsProof(first)).toBe(false);
        act(() => first.setLeaf(50));
        expect(view.container.textContent).toBe('9');
        act(() => second.setLeaf(10));
        expect(view.container.textContent).toBe('10');
        view.unmount();
        expect(recordsProof(second)).toBe(false);
    });

    it('refiles selector-only reads before later owner layout writes', () => {
        const source = makeStore(0);
        let comparisons = 0;
        const compare = (a: number, b: number): boolean => { comparisons++; return a === b; };
        let witnessed = 0;
        function Owner({moved}: {moved: boolean}): React.ReactElement {
            const value = useCarburetorValue(source, moved ? right : left, compare);
            React.useLayoutEffect(() => {
                if (!moved) return;
                const before = comparisons;
                source.setRight(2);
                // Real synchronous selector comparison proves that the new path delivered
                // before passive effects. Eventual DOM alone would accept a passive regression.
                expect(comparisons).toBeGreaterThan(before);
                witnessed++;
            }, [moved]);
            return <p>{value}</p>;
        }
        const view = render(<Owner moved={false}/>);
        expect(recordsProof(source)).toBe(false);
        view.rerender(<Owner moved={true}/>);
        expect(witnessed).toBe(1);
        expect(view.container.textContent).toBe('2');
        view.unmount();
    });
});
