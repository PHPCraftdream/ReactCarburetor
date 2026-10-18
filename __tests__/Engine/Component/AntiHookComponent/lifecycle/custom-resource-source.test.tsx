import {React, act, render, rstest, AntiHookComponent, EResourceStatus, flush} from '../support';
import {Carburetor, IDict, IResourceResolution, IResourceSource, IResourceView} from '@/Carburetor';

/**
 * R16-10(4): `IResourceSource` is `resolve(args) -> {key, path, view}` plus `load(args)` — the
 * six-member split (`keyOf`/`pathOf`/`pathOfKey`/`getEntry`/`getEntryByKey`/`load`) is gone from
 * the interface. This source implements only that pair (plus the `ICarburetorSubscription`
 * surface `Carburetor` already provides) and proves `useResource` needs nothing else, in the
 * class-component form.
 */
interface ICustomEntry {
    status: EResourceStatus;
    value: string | undefined;
}

interface ICustomSourceData {
    entries: IDict<ICustomEntry>;
}

class MinimalResourceSource extends Carburetor<ICustomSourceData> implements IResourceSource<string, [string]> {
    public loadCalls: string[] = [];

    constructor(private readonly loader: (id: string) => Promise<string>) {
        super({entries: {}});
    }

    public resolve(id: string): IResourceResolution<string> {
        const entry = this.data.entries[id];
        const view: IResourceView<string> = {
            status: entry?.status ?? EResourceStatus.Idle,
            data: entry?.value,
            error: undefined,
            updatedAt: undefined,
            refreshing: false,
            invalidated: false,
            failed: false,
            stale: entry === undefined,
        };

        return {key: id, path: `entries.${id}`, view};
    }

    public load(id: string): Promise<void> {
        this.loadCalls.push(id);

        this.draft.entries[id] = {status: EResourceStatus.Pending, value: undefined};
        this.emitUpdate();

        return this.loader(id).then((value: string) => {
            this.draft.entries[id] = {status: EResourceStatus.Success, value};
            this.emitUpdate();
        });
    }
}

describe('a custom IResourceSource implementing only resolve()/load()', () => {
    test('useResource() loads a stale entry and renders its settled value', async () => {
        const settle: Array<(value: string) => void> = [];
        const source = new MinimalResourceSource((id: string) => new Promise<string>((resolve) => {
            settle.push(() => resolve(`loaded-${id}`));
        }));

        class Row extends AntiHookComponent<{id: string}> {
            render() {
                const entry = this.useResource(source, this.props.id);

                return <span className="value">{entry.data ?? entry.status}</span>;
            }
        }

        const {container} = render(<Row id="a" />);

        expect(container.querySelector('.value')?.textContent).toEqual(EResourceStatus.Pending);
        expect(source.loadCalls).toEqual(['a']);

        settle[0]('loaded-a');
        await flush();

        expect(container.querySelector('.value')?.textContent).toEqual('loaded-a');
    });

    test('useResource() subscribes to the resolved path alone', async () => {
        const source = new MinimalResourceSource((id: string) => Promise.resolve(`loaded-${id}`));
        const renders: string[] = [];

        class Row extends AntiHookComponent<{id: string}> {
            render() {
                renders.push(this.props.id);

                const entry = this.useResource(source, this.props.id);

                return <span className="value">{entry.data ?? entry.status}</span>;
            }
        }

        render(<Row id="a" />);
        await flush();

        renders.length = 0;

        // A write to an entry this component never resolved must not re-render it.
        await act(async () => {
            await source.load('unrelated');
        });

        expect(renders).toEqual([]);
    });
});

    describe('mount-super check', () => {
        const watchErrors = (): string[] & {restore: () => void} => {
            const messages: string[] = [];
            const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
                messages.push(args.map(String).join(' '));
            });

            const restore = (): void => spy.mockRestore();

            return Object.assign(messages, {restore}) as string[] & {restore: () => void};
        };

        test('a componentDidMount override without super is reported in development', () => {
            const messages = watchErrors();

            try {
                class Buggy extends AntiHookComponent {
                    public mountedWithoutSuper = false;

                    // oxlint-disable-next-line carburetor/require-super-in-lifecycle
                    public componentDidMount(): void {
                        this.mountedWithoutSuper = true;
                    }

                    render() {
                        return <div/>;
                    }
                }

                const {unmount} = render(<Buggy />);

                // The base lifecycles run on the next commit/unmount and report the skipped super.
                unmount();

                expect(
                    messages.some((message: string) =>
                        message.includes('componentDidMount') && message.includes('super'))
                ).toBe(true);
            } finally {
                messages.restore();
            }
        });

        test('a componentDidMount override that calls super is not reported', () => {
            const messages = watchErrors();

            try {
                class WellBehaved extends AntiHookComponent {
                    public superCalled = false;

                    public componentDidMount(): void {
                        this.superCalled = true;
                        super.componentDidMount();
                    }

                    render() {
                        return <div/>;
                    }
                }

                const {unmount} = render(<WellBehaved />);

                expect(
                    messages.some((message: string) =>
                        message.includes('componentDidMount') && message.includes('super'))
                ).toBe(false);

                unmount();

                expect(
                    messages.some((message: string) =>
                        message.includes('componentDidMount') && message.includes('super'))
                ).toBe(false);
            } finally {
                messages.restore();
            }
        });

        test('a component that does not override componentDidMount is not reported', () => {
            const messages = watchErrors();

            try {
                class Plain extends AntiHookComponent {
                    render() {
                        return <div/>;
                    }
                }

                const {unmount} = render(<Plain />);

                unmount();

                expect(
                    messages.some((message: string) =>
                        message.includes('componentDidMount') && message.includes('super'))
                ).toBe(false);
            } finally {
                messages.restore();
            }
        });

        test('an act-driven update also surfaces the report', () => {
            const messages = watchErrors();

            try {
                class Buggy extends AntiHookComponent<{tick: number}> {
                    // oxlint-disable-next-line carburetor/require-super-in-lifecycle
                    public componentDidMount(): void {
                        // No super call.
                    }

                    render() {
                        return <div>{this.props.tick}</div>;
                    }
                }

                const {rerender, unmount} = render(<Buggy tick={0} />);

                act(() => {
                    rerender(<Buggy tick={1} />);
                });

                expect(
                    messages.some((message: string) =>
                        message.includes('componentDidMount') && message.includes('super'))
                ).toBe(true);

                unmount();
            } finally {
                messages.restore();
            }
        });

        test('a subclass member named checkMountSuper does not hijack the check', () => {
            const messages = watchErrors();
            let collision = false;

            try {
                class Hijacker extends AntiHookComponent {
                    // oxlint-disable-next-line carburetor/require-super-in-lifecycle
                    public componentDidMount(): void {
                        // No super call.
                    }

                    public checkMountSuper(): void {
                        collision = true;
                    }

                    render() {
                        return <div/>;
                    }
                }

                const {unmount} = render(<Hijacker />);

                unmount();

                expect(
                    messages.some((message: string) =>
                        message.includes('componentDidMount') && message.includes('super'))
                ).toBe(true);
                expect(collision).toBe(false);
            } finally {
                messages.restore();
            }
        });

        test('a static getDerivedStateFromProps does not suppress the check', () => {
            const messages = watchErrors();

            try {
                class WithDerived extends AntiHookComponent {
                    public state = {};

                    public static getDerivedStateFromProps(): null {
                        return null;
                    }

                    // oxlint-disable-next-line carburetor/require-super-in-lifecycle
                    public componentDidMount(): void {
                        // No super call.
                    }

                    render() {
                        return <div/>;
                    }
                }

                const {unmount} = render(<WithDerived />);

                unmount();

                expect(
                    messages.some((message: string) =>
                        message.includes('componentDidMount') && message.includes('super'))
                ).toBe(true);
            } finally {
                messages.restore();
            }
        });
    });
