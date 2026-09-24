import * as React from 'react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';
import {render} from '@testing-library/react';

interface IData {
    value: string;
    box: HiddenBox;
}

class HiddenBox {
    public constructor(public value: number) {}
}

class TestCarburetor extends Carburetor<IData> {}

class ErrorBoundary extends React.Component<
    {children: React.ReactNode},
    {message: string | null}
> {
    public state = {message: null as string | null};

    public static getDerivedStateFromError(error: unknown): {message: string} {
        return {message: error instanceof Error ? error.message : String(error)};
    }

    public render(): React.ReactNode {
        return this.state.message
            ? <div role="alert">{this.state.message}</div>
            : this.props.children;
    }
}

describe('hidden selector properties', () => {
    test('a rendered hidden primitive survives the hook snapshot detach', () => {
        const carburetor = new TestCarburetor({value: 'visible through descriptor', box: new HiddenBox(1)});

        const View = () => {
            const selected = useCarburetorValue(carburetor, (data) => {
                const result = {} as {hidden: string};

                Object.defineProperty(result, 'hidden', {value: data.value, enumerable: false});

                return result;
            });

            return <div className="value">{selected.hidden}</div>;
        };

        const {container, unmount} = render(<View/>);

        expect(container.querySelector('.value')?.textContent).toEqual('visible through descriptor');
        unmount();
    });

    test('a hidden class instance fails through an error boundary', () => {
        const carburetor = new TestCarburetor({value: 'x', box: new HiddenBox(1)});
        const View = () => {
            const selected = useCarburetorValue(carburetor, (data) => {
                const result = {} as {hidden: HiddenBox};

                Object.defineProperty(result, 'hidden', {value: data.box, enumerable: false});

                return result;
            });

            return <div>{selected.hidden.value}</div>;
        };
        const originalError = console.error;

        console.error = () => undefined;

        try {
            const {container, unmount} = render(<ErrorBoundary><View/></ErrorBoundary>);

            expect(container.querySelector('[role="alert"]')?.textContent)
                .toContain('useCarburetorValue() cannot select a live HiddenBox instance');
            unmount();
        } finally {
            console.error = originalError;
        }
    });

    test('a hidden accessor fails without evaluating its getter', () => {
        const carburetor = new TestCarburetor({value: 'x', box: new HiddenBox(1)});
        let getterCalls = 0;
        const View = () => {
            const selected = useCarburetorValue(carburetor, () => {
                const result = {} as {hidden: string};

                Object.defineProperty(result, 'hidden', {
                    get: () => {
                        getterCalls++;

                        return 'live';
                    },
                });

                return result;
            });

            return <div>{selected.hidden}</div>;
        };
        const originalError = console.error;

        console.error = () => undefined;

        try {
            const {container, unmount} = render(<ErrorBoundary><View/></ErrorBoundary>);

            expect(container.querySelector('[role="alert"]')?.textContent)
                .toContain('cannot snapshot accessor property hidden');
            expect(getterCalls).toEqual(0);
            unmount();
        } finally {
            console.error = originalError;
        }
    });
});
