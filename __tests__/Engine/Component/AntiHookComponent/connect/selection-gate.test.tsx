import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';

interface IData {
    selectedId: number;
    mode: 'a' | 'b';
    a: number;
    b: number;
}

class Store extends Carburetor<IData> {
    public edit = (fn: (draft: IData) => void): void => {
        this.update(fn);
    };
}

const makeStore = (): Store => new Store({selectedId: 0, mode: 'a', a: 1, b: 2});

describe('connectSelection gates a derived value at notification time (R36-02)', () => {
    test('moving a shared selection renders only the rows whose answer changed', () => {
        const store = makeStore();
        const renders: Record<number, number> = {};
        const control: Record<number, number> = {};

        class GatedRow extends AntiHookComponent<{id: number}> {
            private readonly on = this.connectSelection(() => store, (data) => data.selectedId === this.props.id);

            render() {
                renders[this.props.id] = (renders[this.props.id] ?? 0) + 1;

                return <li className={this.on() ? 'on' : 'off'}>{this.props.id}</li>;
            }
        }

        class PlainRow extends AntiHookComponent<{id: number}> {
            private readonly view = this.connect(() => store);

            render() {
                control[this.props.id] = (control[this.props.id] ?? 0) + 1;

                return <li className={this.view.selectedId === this.props.id ? 'on' : 'off'}>{this.props.id}</li>;
            }
        }

        const ids = Array.from({length: 50}, (_, id) => id);
        const view = render(<><ul>{ids.map((id) => <GatedRow key={id} id={id} />)}</ul>
            <ol>{ids.map((id) => <PlainRow key={id} id={id} />)}</ol></>);
        const total = (counts: Record<number, number>): number => Object.values(counts).reduce((a, b) => a + b, 0);
        const gatedBefore = total(renders);
        const plainBefore = total(control);

        act(() => { store.edit((draft) => { draft.selectedId = 7; }); });
        act(() => { store.edit((draft) => { draft.selectedId = 9; }); });

        // 0 -> 7: rows 0 and 7. 7 -> 9: rows 7 and 9.
        expect(total(renders) - gatedBefore).toBe(4);
        expect(total(control) - plainBefore).toBe(100);
        expect(view.container.querySelectorAll('ul li.on')).toHaveLength(1);
        expect(view.container.querySelector('ul li.on')?.textContent).toBe('9');
        expect(view.container.querySelector('ol li.on')?.textContent).toBe('9');
    });

    test('a selector that switches branch on a later write re-subscribes to the new reads', () => {
        const store = makeStore();
        let renders = 0;

        class Switching extends AntiHookComponent {
            private readonly value = this.connectSelection(
                () => store, (data) => (data.mode === 'a' ? data.a : data.b)
            );

            render() {
                renders++;

                return <p>{this.value()}</p>;
            }
        }

        const view = render(<Switching />);

        act(() => { store.edit((draft) => { draft.b = 20; }); });
        expect(renders).toBe(1);
        act(() => { store.edit((draft) => { draft.mode = 'b'; }); });
        expect(renders).toBe(2);
        expect(view.container.textContent).toBe('20');
        act(() => { store.edit((draft) => { draft.a = 10; }); });
        expect(renders).toBe(2);
        act(() => { store.edit((draft) => { draft.b = 21; }); });
        expect(renders).toBe(3);
        expect(view.container.textContent).toBe('21');
    });

    test('the selector sees the committed props', () => {
        const store = makeStore();
        let renders = 0;

        class ByProp extends AntiHookComponent<{id: number}> {
            private readonly on = this.connectSelection(() => store, (data) => data.selectedId === this.props.id);

            render() {
                renders++;

                return <p>{String(this.on())}</p>;
            }
        }

        const view = render(<ByProp id={1} />);

        view.rerender(<ByProp id={2} />);
        const afterProps = renders;
        act(() => { store.edit((draft) => { draft.selectedId = 1; }); });
        expect(renders).toBe(afterProps);
        act(() => { store.edit((draft) => { draft.selectedId = 2; }); });
        expect(renders).toBe(afterProps + 1);
        expect(view.container.textContent).toBe('true');
    });

    test('StrictMode replays keep the gated subscription and its count', () => {
        const store = makeStore();
        let renders = 0;

        class Row extends AntiHookComponent<{id: number}> {
            private readonly on = this.connectSelection(() => store, (data) => data.selectedId === this.props.id);

            render() {
                renders++;

                return <p>{String(this.on())}</p>;
            }
        }

        const view = render(<React.StrictMode><Row id={3} /></React.StrictMode>);
        const mounted = renders;

        act(() => { store.edit((draft) => { draft.selectedId = 4; }); });
        expect(renders).toBe(mounted);
        act(() => { store.edit((draft) => { draft.selectedId = 3; }); });
        expect(view.container.textContent).toBe('true');
        expect(renders).toBeGreaterThan(mounted);
        view.unmount();
        act(() => { store.edit((draft) => { draft.selectedId = 5; }); });
    });

    test('an object selection that changes still re-renders the owner with the new snapshot', () => {
        const store = makeStore();
        const seen: Array<{a: number}> = [];

        class Owner extends AntiHookComponent {
            private readonly pick = this.connectSelection(() => store, (data) => ({a: data.a}));

            render() {
                const value = this.pick();
                seen.push(value);

                return <p>{value.a}</p>;
            }
        }

        const view = render(<Owner />);

        act(() => { store.edit((draft) => { draft.a = 5; }); });
        act(() => { store.edit((draft) => { draft.b = 9; }); });

        expect(view.container.textContent).toBe('5');
        expect(seen).toHaveLength(2);
        expect(seen[1]).not.toBe(seen[0]);
    });
});
