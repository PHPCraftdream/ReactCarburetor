import {React, act, render, AntiHookComponent, Carburetor} from '../support';

class ValueCarburetor extends Carburetor<{value: number; profile: {name: string}}> {
    public setValue = (value: number): void => {
        this.draft.value = value;
        this.emitUpdate();
    };

    public renameProfile = (name: string): void => {
        this.draft.profile.name = name;
        this.emitUpdate();
    };
}

describe('connectSelection own enumerable string keys (R30-04)', () => {
    test('copies enumerable string keys and updates a memo child', () => {
        const store = new ValueCarburetor({value: 1, profile: {name: 'Ann'}});
        let memoRenders = 0;

        const MemoChild = React.memo(({selection}: {selection: {hidden: number}}) => {
            memoRenders++;

            return <span className="hidden-values">{selection.hidden}</span>;
        });

        class Parent extends AntiHookComponent {
            private readonly selection = this.connectSelection(() => store, (data) => ({hidden: data.value}));

            render() {
                return <MemoChild selection={this.selection()} />;
            }
        }

        const {container, unmount} = render(<Parent />);
        const first = container.querySelector('.hidden-values');

        expect(first?.textContent).toEqual('1');
        expect(memoRenders).toEqual(1);

        act(() => store.setValue(2));

        expect(container.querySelector('.hidden-values')?.textContent).toEqual('2');
        expect(memoRenders).toEqual(2);

        unmount();
    });

    test('a branch stored only behind a non-enumerable key does not reach the child (R30-04)', () => {
        const store = new ValueCarburetor({value: 1, profile: {name: 'Ann'}});
        let memoRenders = 0;

        const MemoChild = React.memo(({selection}: {selection: {plain: number; hidden?: {name: string}}}) => {
            memoRenders++;

            return <span className="hidden-live-view">{selection.plain}:{selection.hidden === undefined ? 'undefined' : 'object'}</span>;
        });

        class Parent extends AntiHookComponent {
            private readonly selection = this.connectSelection(() => store, (data) => {
                const result = {plain: data.value} as {plain: number; hidden?: {name: string}};

                Object.defineProperty(result, 'hidden', {value: data.profile, configurable: true});

                return result;
            });

            render() {
                return <MemoChild selection={this.selection()} />;
            }
        }

        const view = render(<Parent />);

        expect(view.container.querySelector('.hidden-live-view')?.textContent).toEqual('1:undefined');
        expect(memoRenders).toEqual(1);

        act(() => store.renameProfile('Bob'));

        // The non-enumerable key is not part of a selection: nothing child-visible changed,
        // so the snapshot keeps its identity and the memo child keeps its bail-out.
        expect(view.container.querySelector('.hidden-live-view')?.textContent).toEqual('1:undefined');
        expect(memoRenders).toEqual(1);
        view.unmount();
    });

    test('a symbol-keyed branch is not part of a selection and never reaches the child (R30-04)', () => {
        const store = new ValueCarburetor({value: 1, profile: {name: 'Ann'}});
        const TAG = Symbol('selection-tag');

        class Parent extends AntiHookComponent {
            private readonly selection = this.connectSelection(() => store, (data) => {
                const result: Record<PropertyKey, unknown> = {value: data.value};

                result[TAG] = data.profile;

                return result;
            });

            render() {
                const selected = this.selection() as Record<PropertyKey, unknown>;

                return <span className="symbol-branch">
                    {String(selected.value)}:{String(selected[TAG] === undefined)}
                </span>;
            }
        }

        const {container, unmount} = render(<Parent />);
        const text = (): string | undefined => container.querySelector('.symbol-branch')?.textContent;

        expect(text()).toBe('1:true');

        act(() => store.setValue(2));

        expect(text()).toBe('2:true');
        unmount();
    });

    test('an accessor on the selector result is read once and its value is the snapshot (R30-04)', () => {
        const store = new ValueCarburetor({value: 1, profile: {name: 'Ann'}});
        let getterCalls = 0;

        class Parent extends AntiHookComponent {
            private readonly selection = this.connectSelection(() => store, (data) => {
                const result = {} as {hidden: number};

                Object.defineProperty(result, 'hidden', {
                    enumerable: true,
                    configurable: true,
                    get: (): number => {
                        getterCalls++;

                        return data.value;
                    },
                });

                return result;
            });

            render() {
                return <span>{String(this.selection().hidden)}</span>;
            }
        }

        const {container, unmount} = render(<Parent />);

        // The accessor is read once while detaching; the copy keeps its value as plain data.
        expect(container.textContent).toEqual('1');
        expect(getterCalls).toEqual(1);
        unmount();
    });
});
