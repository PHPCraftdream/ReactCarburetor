import * as React from 'react';
import {act, render} from '@testing-library/react';
import {Carburetor, computed} from '@/Carburetor';
import {AntiHookComponent} from '@/Carburetor/Component/AntiHookComponent';
import {shallowEqual} from '@/Carburetor/Component/shallowEqual';
interface IRow {id: number; n: number;}
interface IData {rows: IRow[]; tick: number;}

class EqualityStore extends Carburetor<IData> {
    /** Applies one state update.
     *
     * @param fn - draft mutation
     */
    public change(fn: (draft: IData) => void): void { this.update(fn); }
}

describe('selection consumers with equality readers', () => {
    test('connectSelection supplies appended rows to shallow-equal consumers', () => {
        const store = new EqualityStore({rows: [{id: 0, n: 0}], tick: 0});
        const snapshots: IRow[][] = [];
        class Reader extends AntiHookComponent {
            /** Creates a live selection reader.
             *
             * @returns current selected rows
             */
            private readonly rows = this.connectSelection(() => store, (data: IData) => data.rows);

            public override render(): React.ReactElement {
                const rows = this.rows();
                snapshots.push(rows);
                return React.createElement('span', null, rows.length);
            }
        }
        const {unmount} = render(React.createElement(Reader));
        const prior = snapshots[0];
        act(() => { store.change((draft) => { draft.rows.push({id: 1, n: 1}); }); });
        const next = snapshots[snapshots.length - 1];
        expect(shallowEqual(prior, next)).toBe(false);
        expect(next.map((row) => row.id)).toEqual([0, 1]);
        unmount();
    });

    test('computed equals and shallowEqual see structural membership changes', () => {
        const store = new EqualityStore({rows: [{id: 0, n: 0}], tick: 0});
        const result = computed((read) => read(store).rows.map((row) => row.id), {equals: shallowEqual});
        const before = result.get();
        store.change((draft) => { draft.rows.push({id: 1, n: 1}); });
        const after = result.get();
        expect(before).toEqual([0]);
        expect(after).toEqual([0, 1]);
        expect(shallowEqual(before, after)).toBe(false);
    });
});
