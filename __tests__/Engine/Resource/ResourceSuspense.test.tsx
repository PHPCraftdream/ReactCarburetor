import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, EResourceStatus, ResourceCarburetor} from "@/Carburetor";

interface IDeferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

const deferred = <T extends unknown>(): IDeferred<T> => {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return {promise, resolve, reject};
};

interface IViewProps {
    resource: ResourceCarburetor<string>;
}

class SuspendingView extends AntiHookComponent<IViewProps> {
    render() {
        // Reads nothing off the proxy: suspend() below drives rendering, not field reads.
        this.useCarburetor(this.props.resource);

        return <div className="value">{this.props.resource.suspend(undefined)}</div>;
    }
}

/** Reads the raw status field, the way a component with its own loading indicator would. */
class StatusReader extends AntiHookComponent<IViewProps> {
    render() {
        const state = this.useCarburetor(this.props.resource);

        return <div className="status">{state.status}</div>;
    }
}

interface IBoundaryState {
    message: string | undefined;
}

class Boundary extends React.Component<{children?: React.ReactNode}, IBoundaryState> {
    state: IBoundaryState = {message: undefined};

    static getDerivedStateFromError(error: unknown): IBoundaryState {
        return {message: error instanceof Error ? error.message : String(error)};
    }

    render() {
        if (this.state.message !== undefined) {
            return <div className="failed">{this.state.message}</div>;
        }

        return this.props.children;
    }
}

describe('resource under Suspense', () => {
    test('a class component suspends while the request is in flight', async () => {
        const gate = deferred<string>();
        const resource = new ResourceCarburetor<string>(() => gate.promise);

        const {container, unmount} = render(
            <React.Suspense fallback={<div className="fallback">loading</div>}>
                <SuspendingView resource={resource}/>
            </React.Suspense>
        );

        expect(container.querySelector('.fallback')).not.toBeNull();
        expect(resource.getData().status).toEqual(EResourceStatus.Pending);

        await act(async () => {
            gate.resolve('loaded');
            await gate.promise;
        });

        expect(container.querySelector('.value')?.textContent).toEqual('loaded');
        expect(container.querySelector('.fallback')).toBeNull();
        expect(resource.getData().status).toEqual(EResourceStatus.Success);

        unmount();
    });

    test('a failure reaches the error boundary', async () => {
        // React 19 logs the error this boundary catches; captured so the guard sees
        // only unexpected output.
        const original = console.error;
        const reported: string[] = [];

        console.error = (...args: unknown[]) => reported.push(args.map(String).join(' '));

        try {
            const gate = deferred<string>();
            const resource = new ResourceCarburetor<string>(() => gate.promise);

            const {container, unmount} = render(
                <Boundary>
                    <React.Suspense fallback={<div className="fallback">loading</div>}>
                        <SuspendingView resource={resource}/>
                    </React.Suspense>
                </Boundary>
            );

            expect(container.querySelector('.fallback')).not.toBeNull();

            await act(async () => {
                gate.reject(new Error('request failed'));
                await gate.promise.catch(() => undefined);
            });

            expect(container.querySelector('.failed')?.textContent).toEqual('request failed');

            unmount();
        } finally {
            console.error = original;
        }

        expect(reported.filter((message: string) =>
            message.includes('The above error occurred in the <SuspendingView> component')).length).toEqual(1);
    });

    test('a useCarburetor subscription covering a read field wakes the component on reload', async () => {
        // Pins that the subscription covers exactly the fields read off the result —
        // here `status` — so reload's status/data writes wake this component.
        // Loader hands each call its own gate, answering with the current value of
        // `answer`; reload() re-invokes it, so flipping the variable serves 'second'.
        let answer = 'first';
        const gates: IDeferred<string>[] = [];
        const resource = new ResourceCarburetor<string>(() => {
            const gate = deferred<string>();

            gates.push(gate);
            void Promise.resolve().then(() => gate.resolve(answer));

            return gate.promise;
        });

        let parentRenders = 0;

        class ReloadView extends AntiHookComponent<IViewProps> {
            render() {
                // The subscription covers the fields read — here `status` — so
                // reload's status/data writes wake this component.
                const state = this.useCarburetor(this.props.resource);

                return <div className="value" data-status={state.status}>{this.props.resource.suspend(undefined)}</div>;
            }
        }

        const Parent = () => {
            parentRenders++;

            return <ReloadView resource={resource}/>;
        };

        const {container, unmount} = render(
            <React.Suspense fallback={<div className="fallback">loading</div>}>
                <Parent/>
            </React.Suspense>
        );

        expect(container.querySelector('.fallback')).not.toBeNull();

        await act(async () => {
            await gates[0].promise;
        });

        expect(container.querySelector('.value')?.textContent).toEqual('first');

        const rendersBeforeReload = parentRenders;

        answer = 'second';

        await act(async () => {
            await resource.reload();
        });

        expect(parentRenders).toEqual(rendersBeforeReload);
        expect(container.querySelector('.value')?.textContent).toEqual('second');

        unmount();
    });

    test('a Pending snapshot restored into a fresh instance does not strand a status reader (R3-04)', async () => {
        const gate = deferred<string>();
        const source = new ResourceCarburetor<string>(() => gate.promise);

        const stalled = source.load(undefined);
        const snapshot = source.snapshot();

        let freshCalls = 0;
        const freshGate = deferred<string>();
        const fresh = new ResourceCarburetor<string>(() => {
            freshCalls++;

            return freshGate.promise;
        });

        fresh.restore(snapshot);

        const {container, unmount} = render(<StatusReader resource={fresh}/>);

        // Nothing was ever started against the fresh instance: a reader that only checks
        // status, never calling suspend(), must not be shown a load that will never finish.
        expect(container.querySelector('.status')?.textContent).toEqual(EResourceStatus.Idle);
        expect(freshCalls).toEqual(0);

        // The slot is genuinely idle: an explicit fetch — what an app's own effect would run
        // next to this reader — still works after the restore.
        act(() => {
            void fresh.load(undefined);
        });

        expect(freshCalls).toEqual(1);
        expect(container.querySelector('.status')?.textContent).toEqual(EResourceStatus.Pending);

        await act(async () => {
            freshGate.resolve('resolved-after-restore');
            await freshGate.promise;
        });

        expect(container.querySelector('.status')?.textContent).toEqual(EResourceStatus.Success);

        unmount();
        gate.resolve('late');
        await stalled;
    });
});
