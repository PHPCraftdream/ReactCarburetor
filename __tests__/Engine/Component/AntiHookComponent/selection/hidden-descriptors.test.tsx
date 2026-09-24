import {React, act, render, AntiHookComponent, Carburetor} from '../support';

const HIDDEN_SYMBOL = Symbol('selection-hidden');

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

describe('connectSelection own data descriptors (R11-02)', () => {
    test('preserves hidden string and symbol fields and updates a memo child', () => {
        const store = new ValueCarburetor({value: 1, profile: {name: 'Ann'}});
        let memoRenders = 0;

        const MemoChild = React.memo(({selection}: {selection: {hidden: number; [HIDDEN_SYMBOL]: number}}) => {
            memoRenders++;

            return <span className="hidden-values">{selection.hidden}:{selection[HIDDEN_SYMBOL]}</span>;
        });

        class Parent extends AntiHookComponent {
            private readonly selection = this.connectSelection(() => store, (data) => {
                const result = {} as {hidden: number; [HIDDEN_SYMBOL]: number};

                Object.defineProperty(result, 'hidden', {value: data.value, configurable: true});
                Object.defineProperty(result, HIDDEN_SYMBOL, {value: data.value + 10, configurable: true});

                return result;
            });

            render() {
                return <MemoChild selection={this.selection()} />;
            }
        }

        const {container, unmount} = render(<Parent />);
        const first = container.querySelector('.hidden-values');

        expect(first?.textContent).toEqual('1:11');
        expect(memoRenders).toEqual(1);

        act(() => store.setValue(2));

        expect(container.querySelector('.hidden-values')?.textContent).toEqual('2:12');
        expect(memoRenders).toEqual(2);

        unmount();
    });

    test('detects and tracks a live view stored in a hidden property', () => {
        const store = new ValueCarburetor({value: 1, profile: {name: 'Ann'}});
        let memoRenders = 0;

        const MemoChild = React.memo(({selection}: {selection: {hidden: {name: string}}}) => {
            memoRenders++;

            return <span className="hidden-live-view">{selection.hidden.name}</span>;
        });

        class Parent extends AntiHookComponent {
            private readonly selection = this.connectSelection(() => store, (data) => {
                const result = {} as {hidden: {name: string}};

                Object.defineProperty(result, 'hidden', {value: data.profile, configurable: true});

                return result;
            });

            render() {
                return <MemoChild selection={this.selection()} />;
            }
        }

        const original = console.error;
        const reported: string[] = [];
        let view: ReturnType<typeof render> | undefined;

        console.error = (message: string) => reported.push(message);

        try {
            view = render(<Parent />);

            expect(view.container.querySelector('.hidden-live-view')?.textContent).toEqual('Ann');

            act(() => store.renameProfile('Bob'));

            expect(view.container.querySelector('.hidden-live-view')?.textContent).toEqual('Bob');
            expect(memoRenders).toEqual(2);
        } finally {
            view?.unmount();
            console.error = original;
        }

        expect(reported.filter((message) => message.includes('connectSelection()')).length).toEqual(1);
    });

    test('rejects an accessor selection without running its getter', () => {
        const store = new ValueCarburetor({value: 1, profile: {name: 'Ann'}});
        let getterCalls = 0;

        class Parent extends AntiHookComponent {
            private readonly selection = this.connectSelection(() => store, () => {
                const result = {} as {hidden: number};

                Object.defineProperty(result, 'hidden', {
                    configurable: true,
                    get: (): number => {
                        getterCalls++;

                        return 1;
                    },
                });

                return result;
            });

            render() {
                return <span>{this.selection().hidden}</span>;
            }
        }

        class ErrorBoundary extends React.Component<
            {children: React.ReactNode},
            {message?: string}
        > {
            public state: {message?: string} = {};

            public static getDerivedStateFromError(error: Error): {message: string} {
                return {message: error.message};
            }

            public render(): React.ReactNode {
                return this.state.message === undefined
                    ? this.props.children
                    : <span className="selection-error">{this.state.message}</span>;
            }
        }

        const originalError = console.error;

        console.error = () => undefined;

        try {
            const {container, unmount} = render(<ErrorBoundary><Parent /></ErrorBoundary>);

            expect(container.querySelector('.selection-error')?.textContent)
                .toContain('cannot snapshot accessor property hidden');
            expect(getterCalls).toEqual(0);
            unmount();
        } finally {
            console.error = originalError;
        }
    });
});
