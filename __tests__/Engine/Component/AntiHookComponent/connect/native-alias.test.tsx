/* oxlint-disable carburetor/no-untrackable-store-data */
import {React, act, render, AntiHookComponent, Carburetor} from '../support';

interface IState {
    row: {n: number};
    other: {n: number};
    map: Map<string, {n: number}>;
}

class AliasStore extends Carburetor<IState> {
    public put(n: number): void {
        this.update(draft => { draft.row.n = n; });
    }

    public putOther(n: number): void {
        this.update(draft => { draft.other.n = n; });
    }
}

describe('native plain aliases during a connected render', () => {
    test('Map.get reaches the ordinary row write without rerendering for unrelated plain writes', () => {
        const row = {n: 1};
        const store = new AliasStore({row, other: {n: 0}, map: new Map([['row', row]])});
        let renders = 0;

        class Row extends AntiHookComponent {
            private readonly view = this.connect(() => store);

            render() {
                renders++;
                return <div className="value">{this.view.map.get('row')?.n}</div>;
            }
        }

        const {container, unmount} = render(<Row />);
        expect(container.querySelector('.value')?.textContent).toBe('1');
        expect(renders).toBe(1);

        act(() => store.putOther(4));
        expect(renders).toBe(1);
        act(() => store.put(2));
        expect(container.querySelector('.value')?.textContent).toBe('2');
        expect(renders).toBe(2);
        unmount();
    });
});
