import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import type {TReadonly} from '@/Carburetor/Models/Base';
import {rstest} from '@rstest/core';

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

interface IBranchData {
    useLeft: boolean;
    left: number;
    right: number;
    boom: boolean;
}

class BranchStore extends Carburetor<IBranchData> {
    public edit = (fn: (draft: IBranchData) => void): void => {
        this.update(fn);
    };
}

const makeBranchStore = (): BranchStore =>
    new BranchStore({useLeft: true, left: 1, right: 1, boom: false});

const selectBranch = (data: TReadonly<IBranchData>): number => (data.useLeft ? data.left : data.right);

describe('connectSelection migrates an equal-valued branch switch without a render (R37-06)', () => {
    test('useLeft true->false with left===right keeps the class owner at one render, like the hook', () => {
        const store = makeBranchStore();
        let hookRenders = 0;
        let classRenders = 0;

        const Hook = (): React.ReactElement => {
            hookRenders++;

            return <p>{useCarburetorValue(store, selectBranch)}</p>;
        };

        class Owner extends AntiHookComponent {
            private readonly branch = this.connectSelection(() => store, selectBranch);

            render() {
                classRenders++;

                return <p>{this.branch()}</p>;
            }
        }

        const hookView = render(<Hook />);
        const classView = render(<Owner />);

        expect(hookRenders).toBe(1);
        expect(classRenders).toBe(1);
        expect(hookView.container.textContent).toBe('1');
        expect(classView.container.textContent).toBe('1');

        // Equal-valued branch switch: read-set migration only, no owner render.
        act(() => { store.edit((draft) => { draft.useLeft = false; }); });

        expect(hookRenders).toBe(1);
        expect(classRenders).toBe(1);
        expect(hookView.container.textContent).toBe('1');
        expect(classView.container.textContent).toBe('1');

        // The migrated subscription no longer covers the old branch.
        act(() => { store.edit((draft) => { draft.left = 2; }); });

        expect(hookRenders).toBe(1);
        expect(classRenders).toBe(1);
        expect(hookView.container.textContent).toBe('1');
        expect(classView.container.textContent).toBe('1');
    });

    test('a real value change on the migrated branch renders the owner and updates the DOM', () => {
        const store = makeBranchStore();
        let renders = 0;

        class Owner extends AntiHookComponent {
            private readonly branch = this.connectSelection(() => store, selectBranch);

            render() {
                renders++;

                return <p>{this.branch()}</p>;
            }
        }

        const view = render(<Owner />);

        act(() => { store.edit((draft) => { draft.useLeft = false; }); });
        expect(renders).toBe(1);
        expect(view.container.textContent).toBe('1');

        act(() => { store.edit((draft) => { draft.right = 3; }); });
        expect(renders).toBe(2);
        expect(view.container.textContent).toBe('3');
    });

    test('a real value change without a branch switch still renders and updates the DOM', () => {
        const store = makeBranchStore();
        let renders = 0;

        class Owner extends AntiHookComponent {
            private readonly branch = this.connectSelection(() => store, selectBranch);

            render() {
                renders++;

                return <p>{this.branch()}</p>;
            }
        }

        const view = render(<Owner />);

        act(() => { store.edit((draft) => { draft.left = 3; }); });

        expect(renders).toBe(2);
        expect(view.container.textContent).toBe('3');
    });

    test('a notification while a render attempt is open takes the plain re-render path', () => {
        const store = makeBranchStore();
        let renders = 0;
        let switchDuringRender = false;
        const errorSpy = rstest.spyOn(console, 'error').mockImplementation(() => {});

        class Owner extends AntiHookComponent<{tick: number}> {
            private readonly branch = this.connectSelection(() => store, selectBranch);

            render() {
                renders++;

                if (switchDuringRender) {
                    switchDuringRender = false;
                    // Equal-valued branch switch fired while this render attempt is open: the
                    // guard must keep this on the re-render path, not re-file mid-render.
                    store.edit((draft) => { draft.useLeft = false; });
                }

                return <p>{this.branch()}</p>;
            }
        }

        const view = render(<Owner tick={0} />);
        expect(renders).toBe(1);

        act(() => { switchDuringRender = true; view.rerender(<Owner tick={1} />); });

        errorSpy.mockRestore();

        // The re-render from the render-phase update, at most one extra pass — never a loop.
        expect(renders).toBeGreaterThan(1);
        expect(renders).toBeLessThan(5);
        expect(view.container.textContent).toBe('1');

        // The commit after the guarded render filed the new branch: the old one is silent.
        const afterSwitch = renders;
        act(() => { store.edit((draft) => { draft.left = 2; }); });
        expect(renders).toBe(afterSwitch);
        expect(view.container.textContent).toBe('1');
    });

    test('a selector throw during the notification re-run still takes the plain re-render', () => {
        const store = makeBranchStore();
        let renders = 0;

        class Owner extends AntiHookComponent {
            private inRender = false;
            private readonly branch = this.connectSelection(() => store, (data) => {
                if (data.boom && !this.inRender) {
                    throw new Error('notification-only failure');
                }

                return data.useLeft ? data.left : data.right;
            });

            render() {
                renders++;
                this.inRender = true;

                try {
                    return <p>{this.branch()}</p>;
                } finally {
                    this.inRender = false;
                }
            }
        }

        const view = render(<Owner />);
        expect(renders).toBe(1);

        act(() => {
            store.edit((draft) => {
                draft.boom = true;
                draft.useLeft = false;
            });
        });

        // The throw forces the owner render; that render re-files the new branch.
        expect(renders).toBe(2);
        expect(view.container.textContent).toBe('1');

        // And after the failed attempt, the migrated branch is the subscribed one.
        act(() => { store.edit((draft) => { draft.left = 2; }); });
        expect(renders).toBe(2);
    });

    test('a source swap takes the plain re-render and re-arms migration on the new source', () => {
        const storeA = makeBranchStore();
        const storeB = makeBranchStore();
        let renders = 0;

        class Owner extends AntiHookComponent<{store: BranchStore}> {
            private readonly branch = this.connectSelection(() => this.props.store, selectBranch);

            render() {
                renders++;

                return <p>{this.branch()}</p>;
            }
        }

        const view = render(<Owner store={storeA} />);
        expect(renders).toBe(1);

        view.rerender(<Owner store={storeB} />);
        const afterSwap = renders;
        expect(afterSwap).toBeGreaterThan(1);

        // The old source is no longer subscribed; the new one drives the owner.
        act(() => { storeA.edit((draft) => { draft.left = 2; }); });
        expect(renders).toBe(afterSwap);

        // Equal-valued branch switch on the new source migrates without a render.
        act(() => { storeB.edit((draft) => { draft.useLeft = false; }); });
        expect(renders).toBe(afterSwap);
        expect(view.container.textContent).toBe('1');

        act(() => { storeB.edit((draft) => { draft.right = 3; }); });
        expect(renders).toBe(afterSwap + 1);
        expect(view.container.textContent).toBe('3');
    });

    test('StrictMode runs the selector once per write and never renders from an equal branch switch', () => {
        const store = makeBranchStore();
        let renders = 0;
        let selectorRuns = 0;
        const counted = (data: TReadonly<IBranchData>): number => {
            selectorRuns++;

            return selectBranch(data);
        };

        class Owner extends AntiHookComponent {
            private readonly branch = this.connectSelection(() => store, counted);

            render() {
                renders++;

                return <p>{this.branch()}</p>;
            }
        }

        const view = render(<React.StrictMode><Owner /></React.StrictMode>);
        const mountedRuns = selectorRuns;
        const mountedRenders = renders;

        // Equal-valued branch switch: the selector re-runs once at notification time to
        // discover the moved read set, but the owner does not render.
        act(() => { store.edit((draft) => { draft.useLeft = false; }); });
        expect(selectorRuns).toBe(mountedRuns + 1);
        expect(renders).toBe(mountedRenders);
        expect(view.container.textContent).toBe('1');

        act(() => { store.edit((draft) => { draft.left = 2; }); });
        expect(selectorRuns).toBe(mountedRuns + 1);
        expect(renders).toBe(mountedRenders);

        // React may replay render work; the notification-only switch above runs the selector once.
        const beforeChange = selectorRuns;
        const rendersBeforeChange = renders;
        act(() => { store.edit((draft) => { draft.right = 2; }); });
        expect(selectorRuns).toBeGreaterThan(beforeChange);
        expect(renders).toBeGreaterThan(rendersBeforeChange);
        expect(view.container.textContent).toBe('2');
    });
});

interface ILiveRow {
    id: string;
    n: number;
    peer: Map<string, ILiveRow> | null;
}

class LiveListStore extends Carburetor<{rows: ILiveRow[]}> {
    public edit = (fn: (draft: {rows: ILiveRow[]}) => void): void => {
        this.update(fn);
    };
}

describe('connectSelection keeps a shared live-list alias across edits (R37-01 regression)', () => {
    test('a class selection over an initially shared list keeps the alias, both values, and held snapshots', () => {
        const rows: ILiveRow[] = [
            {id: 'a', n: 1, peer: null},
            {id: 'b', n: 1, peer: null},
        ];
        rows[0].peer = new Map([['peer', rows[1]]]);
        const store = new LiveListStore({rows});
        const seen: Array<TReadonly<ILiveRow[]>> = [];

        class Owner extends AntiHookComponent {
            private readonly list = this.connectSelection(() => store, (data) => data.rows);

            render() {
                seen.push(this.list());

                return <p>{String(this.list()[1].n)}</p>;
            }
        }

        const view = render(<Owner />);
        expect(view.container.textContent).toBe('1');

        act(() => { store.edit((draft) => { draft.rows[1].n = 2; }); });
        act(() => { store.edit((draft) => { draft.rows[1].n = 3; }); });

        expect(view.container.textContent).toBe('3');
        expect(seen).toHaveLength(3);
        for (const [index, n] of [1, 2, 3].entries()) {
            const snapshot = seen[index];
            const peer = (snapshot[0].peer as Map<string, ILiveRow>).get('peer');
            // The alias identity holds inside every snapshot, pointing at its own member.
            expect(peer).toBe(snapshot[1]);
            expect(snapshot[1].n).toBe(n);
        }
        // Held snapshots are immutable: each edit produced a fresh snapshot.
        expect(seen[1]).not.toBe(seen[0]);
        expect(seen[2]).not.toBe(seen[1]);
        expect(seen[0][1].n).toBe(1);
        expect(seen[1][1].n).toBe(2);
    });
});
