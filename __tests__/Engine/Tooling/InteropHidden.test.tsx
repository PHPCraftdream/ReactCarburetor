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

describe('hidden selector properties (R30-04: not part of a selection)', () => {
    test('a non-enumerable primitive does not reach the hook snapshot', () => {
        const carburetor = new TestCarburetor({value: 'visible through descriptor', box: new HiddenBox(1)});

        const View = () => {
            const selected = useCarburetorValue(carburetor, (data) => {
                const result = {} as {plain: string; hidden: string};

                result.plain = data.value;
                Object.defineProperty(result, 'hidden', {value: data.value, enumerable: false});

                return result;
            });

            return <div className="value">{String(selected.plain)}:{String(selected.hidden)}</div>;
        };

        const {container, unmount} = render(<View/>);

        expect(container.querySelector('.value')?.textContent).toEqual('visible through descriptor:undefined');
        unmount();
    });

    test('a hidden class instance is never detached, so it never throws', () => {
        const carburetor = new TestCarburetor({value: 'x', box: new HiddenBox(1)});
        const View = () => {
            const selected = useCarburetorValue(carburetor, (data) => {
                const result = {} as {plain: string; hidden: HiddenBox};

                result.plain = data.value;
                Object.defineProperty(result, 'hidden', {value: data.box, enumerable: false});

                return result;
            });

            return <div>{String(selected.plain)}:{String(selected.hidden)}</div>;
        };
        const {container, unmount} = render(<ErrorBoundary><View/></ErrorBoundary>);

        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.textContent).toEqual('x:undefined');
        unmount();
    });

    test('a non-enumerable accessor is never read; an enumerable one is read once', () => {
        const carburetor = new TestCarburetor({value: 'x', box: new HiddenBox(1)});
        let hiddenCalls = 0;
        let plainCalls = 0;
        const View = () => {
            const selected = useCarburetorValue(carburetor, () => {
                const result = {} as {plain: string; hidden: string};

                Object.defineProperty(result, 'hidden', {
                    get: () => {
                        hiddenCalls++;

                        return 'live';
                    },
                });
                Object.defineProperty(result, 'plain', {
                    enumerable: true,
                    configurable: true,
                    get: () => {
                        plainCalls++;

                        return 'plain';
                    },
                });

                return result;
            });

            return <div>{String(selected.plain)}:{String(selected.hidden)}</div>;
        };
        const {container, unmount} = render(<View/>);

        expect(container.textContent).toEqual('plain:undefined');
        expect(plainCalls).toEqual(1);
        expect(hiddenCalls).toEqual(0);
        unmount();
    });
});
